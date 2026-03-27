import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { toNumber } from "../lib/serializers";
import {
  calculateSharedItemCost,
  calculateClaimAmount,
  ParticipantStatus,
} from "@splitcheck/shared";
import { ValidationError, NotFoundError } from "./session-service";
import { transitionParticipant } from "./state-machine-service";

type TransactionClient = Prisma.TransactionClient;

interface ClaimItemInput {
  participantId: string;
  quantity: number;
  isShared: boolean;
}

interface ClaimRecord {
  claimId: string;
  itemId: string;
  participantId: string;
  quantity: number;
  shareFraction: Prisma.Decimal;
  amount: Prisma.Decimal;
  createdAt: Date;
}

function serializeClaimRecord(claim: ClaimRecord) {
  return {
    claimId: claim.claimId,
    itemId: claim.itemId,
    participantId: claim.participantId,
    quantity: claim.quantity,
    shareFraction: toNumber(claim.shareFraction),
    amount: toNumber(claim.amount),
    createdAt: claim.createdAt.toISOString(),
  };
}

export async function claimItem(itemId: string, input: ClaimItemInput) {
  if (input.quantity < 1) {
    throw new ValidationError("Claim quantity must be at least 1");
  }

  return await prisma.$transaction(async (tx: TransactionClient) => {
    const item = await tx.billItem.findUnique({
      where: { itemId },
      include: { claims: true, session: true },
    });

    if (!item) {
      throw new NotFoundError("Item not found");
    }

    if (
      item.session.status !== "OPEN" &&
      item.session.status !== "PARTIALLY_SETTLED" &&
      item.session.status !== "DISPUTED"
    ) {
      throw new ValidationError("Session is not open for claims");
    }

    const participant = await tx.participant.findUnique({
      where: { participantId: input.participantId },
    });

    if (!participant) {
      throw new NotFoundError("Participant not found");
    }

    if (participant.sessionId !== item.sessionId) {
      throw new ValidationError("Participant is not in this session");
    }

    // Can only claim while BROWSING or CLAIMING
    const claimableStatuses: string[] = [
      ParticipantStatus.BROWSING,
      ParticipantStatus.CLAIMING,
    ];
    if (!claimableStatuses.includes(participant.status)) {
      throw new ValidationError("Cannot claim items in current status");
    }

    const existingClaim = item.claims.find(
      (c: ClaimRecord) => c.participantId === input.participantId
    );
    if (existingClaim) {
      throw new ValidationError("You have already claimed this item");
    }

    if (input.isShared || item.isShared) {
      const currentClaimantCount = item.claims.length;
      const newClaimantCount = currentClaimantCount + 1;
      const shareFraction = 1 / newClaimantCount;
      const amount = calculateSharedItemCost(
        toNumber(item.lineTotal),
        newClaimantCount
      );

      const claim = await tx.claim.create({
        data: {
          itemId,
          participantId: input.participantId,
          quantity: 1,
          shareFraction,
          amount,
        },
      });

      for (const existingClaimOnItem of item.claims as ClaimRecord[]) {
        await tx.claim.update({
          where: { claimId: existingClaimOnItem.claimId },
          data: {
            shareFraction,
            amount,
          },
        });
      }

      await tx.billItem.update({
        where: { itemId },
        data: { claimedQty: newClaimantCount },
      });

      if (participant.status === ParticipantStatus.BROWSING) {
        await transitionParticipant(input.participantId, ParticipantStatus.CLAIMING, {
          tx,
          skipBroadcast: true,
          skipSessionRecompute: true,
        });
      }

      return serializeClaimRecord(claim as ClaimRecord);
    } else {
      const totalClaimed = (item.claims as ClaimRecord[]).reduce(
        (sum: number, c: ClaimRecord) => sum + c.quantity,
        0
      );
      const availableQty = item.quantity - totalClaimed;

      if (input.quantity > availableQty) {
        throw new ValidationError(
          `Only ${availableQty} unit(s) available. ${totalClaimed} already claimed.`
        );
      }

      const amount = calculateClaimAmount(
        toNumber(item.unitPrice),
        input.quantity
      );

      const claim = await tx.claim.create({
        data: {
          itemId,
          participantId: input.participantId,
          quantity: input.quantity,
          shareFraction: 1,
          amount,
        },
      });

      await tx.billItem.update({
        where: { itemId },
        data: { claimedQty: totalClaimed + input.quantity },
      });

      if (participant.status === ParticipantStatus.BROWSING) {
        await transitionParticipant(input.participantId, ParticipantStatus.CLAIMING, {
          tx,
          skipBroadcast: true,
          skipSessionRecompute: true,
        });
      }

      return serializeClaimRecord(claim as ClaimRecord);
    }
  });
}

export async function unclaimItem(claimId: string) {
  return await prisma.$transaction(async (tx: TransactionClient) => {
    const claim = await tx.claim.findUnique({
      where: { claimId },
      include: { item: { include: { claims: true } }, participant: true },
    });

    if (!claim) {
      throw new NotFoundError("Claim not found");
    }

    // Can only unclaim while BROWSING, CLAIMING, or REVIEWING
    const unclaimableStatuses: string[] = [
      ParticipantStatus.BROWSING,
      ParticipantStatus.CLAIMING,
      ParticipantStatus.REVIEWING,
    ];
    if (!unclaimableStatuses.includes(claim.participant.status)) {
      throw new ValidationError("Cannot unclaim in current status");
    }

    await tx.claim.delete({ where: { claimId } });

    if (claim.item.isShared) {
      const remainingClaims = (claim.item.claims as ClaimRecord[]).filter(
        (c: ClaimRecord) => c.claimId !== claimId
      );
      const newClaimantCount = remainingClaims.length;

      if (newClaimantCount > 0) {
        const newShareFraction = 1 / newClaimantCount;
        const newAmount = calculateSharedItemCost(
          toNumber(claim.item.lineTotal),
          newClaimantCount
        );

        for (const remaining of remainingClaims) {
          await tx.claim.update({
            where: { claimId: remaining.claimId },
            data: { shareFraction: newShareFraction, amount: newAmount },
          });
        }
      }

      await tx.billItem.update({
        where: { itemId: claim.itemId },
        data: { claimedQty: newClaimantCount },
      });
    } else {
      const newClaimedQty = claim.item.claimedQty - claim.quantity;
      await tx.billItem.update({
        where: { itemId: claim.itemId },
        data: { claimedQty: Math.max(0, newClaimedQty) },
      });
    }

    const remainingParticipantClaims = await tx.claim.findMany({
      where: { participantId: claim.participantId },
    });

    if (remainingParticipantClaims.length === 0) {
      // Only transition to BROWSING if currently CLAIMING
      if (claim.participant.status === ParticipantStatus.CLAIMING) {
        await transitionParticipant(claim.participantId, ParticipantStatus.BROWSING, {
          tx,
          skipBroadcast: true,
          skipSessionRecompute: true,
        });
      }
    }

    return { deleted: true };
  });
}
