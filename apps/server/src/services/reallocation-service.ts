/**
 * Reallocation Service
 *
 * Handles unclaimed items after guests check out:
 * - Assign to a specific guest
 * - Split equally among all participants
 * - Host absorbs (covers the cost)
 *
 * Any reallocation that changes a guest's total reverts them to REVIEWING.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { toNumber } from "../lib/serializers";
import { pushFeedEvent } from "./feed-service";
import { buildAndCacheState } from "./state-service";
import {
  transitionParticipant,
  recomputeSessionStatus,
} from "./state-machine-service";
import { getIO } from "../ws/socket-server";
import {
  ParticipantStatus,
  SessionStatus,
  calculateClaimAmount,
  calculateSharedItemCost,
  bankersRound,
} from "@splitcheck/shared";
import { ValidationError, NotFoundError } from "./session-service";

type TransactionClient = Prisma.TransactionClient;

// ─── Validation Helpers ─────────────────────────────────────────────

async function validateReallocationContext(itemId: string) {
  const item = await prisma.billItem.findUnique({
    where: { itemId },
    include: {
      session: { include: { participants: true } },
      claims: true,
    },
  });

  if (!item) {
    throw new NotFoundError("Item not found");
  }

  const sessionStatus = item.session.status;
  if (
    sessionStatus !== SessionStatus.PARTIALLY_SETTLED &&
    sessionStatus !== SessionStatus.DISPUTED &&
    sessionStatus !== SessionStatus.SETTLED
  ) {
    throw new ValidationError(
      "Reallocation is only available after at least one guest has checked out"
    );
  }

  if (item.absorbedByHost) {
    throw new ValidationError("Item has already been absorbed by the host");
  }

  // Check if item has unclaimed quantity
  const totalClaimed = item.claims.reduce(
    (sum: number, c: { quantity: number }) => sum + c.quantity,
    0
  );
  const isShared = item.isShared;

  // For shared items: if nobody has claimed it, it's fully unclaimed
  // For non-shared items: if claimedQty < quantity, there are unclaimed units
  if (!isShared && totalClaimed >= item.quantity) {
    throw new ValidationError("Item is fully claimed — no unclaimed quantity");
  }
  if (isShared && totalClaimed > 0) {
    throw new ValidationError("Shared item already has claimants");
  }

  return item;
}

/**
 * Revert participants who have already checked out or settled back to REVIEWING.
 * This forces them to re-confirm their updated total.
 */
async function revertAffectedParticipants(
  participantIds: string[]
): Promise<void> {
  for (const pid of participantIds) {
    const p = await prisma.participant.findUnique({
      where: { participantId: pid },
    });
    if (!p) continue;

    if (
      p.status === ParticipantStatus.CHECKED_OUT ||
      p.status === ParticipantStatus.SETTLED
    ) {
      await transitionParticipant(pid, ParticipantStatus.REVIEWING);
    }
  }
}

// ─── Assign to Specific Guest ───────────────────────────────────────

export async function assignItem(itemId: string, participantId: string) {
  const item = await validateReallocationContext(itemId);

  const participant = await prisma.participant.findUnique({
    where: { participantId },
  });

  if (!participant) {
    throw new NotFoundError("Participant not found");
  }

  if (participant.sessionId !== item.sessionId) {
    throw new ValidationError("Participant is not in this session");
  }

  // Check if participant already has a claim on this item
  const existingClaim = item.claims.find(
    (c: { participantId: string }) => c.participantId === participantId
  );
  if (existingClaim) {
    throw new ValidationError("Participant already has a claim on this item");
  }

  const unclaimedQty = item.isShared ? 1 : item.quantity - item.claimedQty;
  const amount = item.isShared
    ? toNumber(item.lineTotal)
    : calculateClaimAmount(toNumber(item.unitPrice), unclaimedQty);

  await prisma.$transaction(async (tx: TransactionClient) => {
    // Create claim
    await tx.claim.create({
      data: {
        itemId,
        participantId,
        quantity: unclaimedQty,
        shareFraction: 1,
        amount,
      },
    });

    // Update item claimed qty
    await tx.billItem.update({
      where: { itemId },
      data: {
        claimedQty: item.isShared
          ? 1
          : item.claimedQty + unclaimedQty,
      },
    });

    // Add the amount to the participant's subtotal and total
    const newSubtotal = bankersRound(toNumber(participant.subtotal) + amount, 2);
    const newTotal = bankersRound(
      newSubtotal + toNumber(participant.taxShare) + toNumber(participant.serviceShare),
      2
    );

    await tx.participant.update({
      where: { participantId },
      data: {
        subtotal: newSubtotal,
        total: newTotal,
      },
    });
  });

  // Revert the assigned participant to REVIEWING if needed
  await revertAffectedParticipants([participantId]);

  // Recompute session status
  await recomputeSessionStatus(item.sessionId);

  // WebSocket: notify the affected guest
  try {
    const io = getIO();
    const room = `session:${item.sessionId}`;
    io.to(room).emit("item:reassigned", {
      item_id: itemId,
      item_name: item.name,
      participant_id: participantId,
      participant_name: participant.displayName,
      action: "assign",
      amount_change: amount,
    });
  } catch {
    // IO not ready
  }

  // Feed event
  await pushFeedEvent(item.sessionId, {
    type: "item_reassigned",
    actor_name: participant.displayName,
    item_name: item.name,
    amount: amount,
    claimant_count: undefined,
  });

  await buildAndCacheState(item.sessionId);

  return { success: true, item_name: item.name, assigned_to: participant.displayName, amount };
}

// ─── Split Equally Among All ────────────────────────────────────────

export async function splitItemEqually(itemId: string) {
  const item = await validateReallocationContext(itemId);

  const participants = item.session.participants;
  const participantCount = participants.length;

  if (participantCount === 0) {
    throw new ValidationError("No participants to split among");
  }

  const totalCost = item.isShared
    ? toNumber(item.lineTotal)
    : calculateClaimAmount(
        toNumber(item.unitPrice),
        item.quantity - item.claimedQty
      );

  const perPerson = bankersRound(totalCost / participantCount, 2);

  await prisma.$transaction(async (tx: TransactionClient) => {
    // Mark item as shared and fully claimed
    await tx.billItem.update({
      where: { itemId },
      data: {
        isShared: true,
        claimedQty: participantCount,
      },
    });

    // Delete any existing claims for this item (clean slate for the split)
    await tx.claim.deleteMany({
      where: { itemId },
    });

    // Create equal claims for every participant
    for (const p of participants) {
      await tx.claim.create({
        data: {
          itemId,
          participantId: p.participantId,
          quantity: 1,
          shareFraction: bankersRound(1 / participantCount, 4),
          amount: perPerson,
        },
      });

      // Update participant's subtotal and total
      const newSubtotal = bankersRound(toNumber(p.subtotal) + perPerson, 2);
      const newTotal = bankersRound(
        newSubtotal + toNumber(p.taxShare) + toNumber(p.serviceShare),
        2
      );

      await tx.participant.update({
        where: { participantId: p.participantId },
        data: {
          subtotal: newSubtotal,
          total: newTotal,
        },
      });
    }
  });

  // Revert all participants who were CHECKED_OUT or SETTLED
  const participantIds = participants.map((p: { participantId: string }) => p.participantId);
  await revertAffectedParticipants(participantIds);

  // Recompute session status
  await recomputeSessionStatus(item.sessionId);

  // WebSocket: notify all
  try {
    const io = getIO();
    const room = `session:${item.sessionId}`;
    io.to(room).emit("item:reassigned", {
      item_id: itemId,
      item_name: item.name,
      participant_id: "",
      participant_name: "everyone",
      action: "split",
      amount_change: perPerson,
    });
  } catch {
    // IO not ready
  }

  // Feed event
  await pushFeedEvent(item.sessionId, {
    type: "item_split",
    actor_name: "Host",
    item_name: item.name,
    amount: totalCost,
    claimant_count: participantCount,
  });

  await buildAndCacheState(item.sessionId);

  return { success: true, item_name: item.name, per_person: perPerson, total_cost: totalCost };
}

// ─── Host Absorbs ───────────────────────────────────────────────────

export async function absorbItem(itemId: string) {
  const item = await validateReallocationContext(itemId);

  // Mark as absorbed — no participant totals change
  await prisma.billItem.update({
    where: { itemId },
    data: { absorbedByHost: true },
  });

  // Feed event
  await pushFeedEvent(item.sessionId, {
    type: "item_absorbed",
    actor_name: "Host",
    item_name: item.name,
    amount: toNumber(item.lineTotal),
    claimant_count: undefined,
  });

  // WebSocket: notify all
  try {
    const io = getIO();
    const room = `session:${item.sessionId}`;
    io.to(room).emit("item:reassigned", {
      item_id: itemId,
      item_name: item.name,
      participant_id: "",
      participant_name: "Host",
      action: "absorb",
      amount_change: 0,
    });
  } catch {
    // IO not ready
  }

  await buildAndCacheState(item.sessionId);

  return { success: true, item_name: item.name, absorbed: true };
}
