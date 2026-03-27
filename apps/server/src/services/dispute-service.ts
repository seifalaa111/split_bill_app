/**
 * Dispute Service
 *
 * Handles the full dispute lifecycle:
 * - Guest raises dispute (OPEN)
 * - Host resolves: ADJUST, REJECT, or OVERRIDE
 * - Re-dispute logic with 3-dispute limit
 *
 * Dispute details are private between host and the disputing guest.
 * The Activity Feed shows only neutral messages to other guests.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { toNumber } from "../lib/serializers";
import { pushFeedEvent } from "./feed-service";
import { buildAndCacheState } from "./state-service";
import { transitionParticipant, recomputeSessionStatus } from "./state-machine-service";
import { getIO, getHostSocketIds, getParticipantSocketIds } from "../ws/socket-server";
import {
  ParticipantStatus,
  MAX_DISPUTES_PER_PARTICIPANT,
  VALIDATION,
} from "@splitcheck/shared";
import { ValidationError, NotFoundError } from "./session-service";

// ─── Types ──────────────────────────────────────────────────────────

interface CreateDisputeInput {
  sessionId: string;
  participantId: string;
  reason: string;
}

interface ResolveDisputeInput {
  status: "RESOLVED" | "REJECTED";
  resolutionType: "ADJUST" | "REJECT" | "OVERRIDE";
  resolutionNote?: string;
  adjustedTotal?: number;
}

interface DisputeRecord {
  disputeId: string;
  sessionId: string;
  participantId: string;
  reason: string;
  status: string;
  resolutionNote: string | null;
  resolutionType: string | null;
  originalTotal: Prisma.Decimal;
  adjustedTotal: Prisma.Decimal | null;
  createdAt: Date;
  resolvedAt: Date | null;
}

function serializeDispute(dispute: DisputeRecord) {
  return {
    disputeId: dispute.disputeId,
    sessionId: dispute.sessionId,
    participantId: dispute.participantId,
    reason: dispute.reason,
    status: dispute.status,
    resolutionNote: dispute.resolutionNote,
    resolutionType: dispute.resolutionType,
    originalTotal: toNumber(dispute.originalTotal),
    adjustedTotal: dispute.adjustedTotal ? toNumber(dispute.adjustedTotal) : null,
    createdAt: dispute.createdAt.toISOString(),
    resolvedAt: dispute.resolvedAt?.toISOString() ?? null,
  };
}

// ─── Create Dispute ─────────────────────────────────────────────────

export async function createDispute(input: CreateDisputeInput) {
  // Validate reason
  if (
    !input.reason ||
    input.reason.trim().length < VALIDATION.disputeReason.minLength ||
    input.reason.trim().length > VALIDATION.disputeReason.maxLength
  ) {
    throw new ValidationError(
      `Dispute reason must be between ${VALIDATION.disputeReason.minLength} and ${VALIDATION.disputeReason.maxLength} characters`
    );
  }

  const participant = await prisma.participant.findUnique({
    where: { participantId: input.participantId },
  });

  if (!participant) {
    throw new NotFoundError("Participant not found");
  }

  if (participant.sessionId !== input.sessionId) {
    throw new ValidationError("Participant is not in this session");
  }

  // Validate participant status — can only dispute from REVIEWING or CHECKED_OUT
  if (
    participant.status !== ParticipantStatus.REVIEWING &&
    participant.status !== ParticipantStatus.CHECKED_OUT
  ) {
    throw new ValidationError(
      "Can only raise a dispute from REVIEWING or CHECKED_OUT status"
    );
  }

  // Check dispute count limit
  const disputeCount = await prisma.dispute.count({
    where: {
      participantId: input.participantId,
      sessionId: input.sessionId,
    },
  });

  if (disputeCount >= MAX_DISPUTES_PER_PARTICIPANT) {
    throw new ValidationError(
      "You've reached the maximum number of disputes. The host will handle it from here."
    );
  }

  // Create the dispute record
  const dispute = await prisma.dispute.create({
    data: {
      sessionId: input.sessionId,
      participantId: input.participantId,
      reason: input.reason.trim(),
      status: "OPEN",
      originalTotal: participant.total,
    },
  });

  // Transition participant to DISPUTED
  await transitionParticipant(input.participantId, ParticipantStatus.DISPUTED);

  // Send dispute:raised to HOST only (not broadcast to room)
  try {
    const io = getIO();
    const hostSocketIds = getHostSocketIds(input.sessionId);
    for (const socketId of hostSocketIds) {
      io.to(socketId).emit("dispute:raised", {
        dispute_id: dispute.disputeId,
        participant_id: input.participantId,
        participant_name: participant.displayName,
        reason: input.reason.trim(),
      });
    }
  } catch {
    // IO not ready
  }

  // Push neutral feed event (visible to ALL)
  await pushFeedEvent(input.sessionId, {
    type: "dispute_raised",
    actor_name: participant.displayName,
    item_name: undefined,
    amount: undefined,
    claimant_count: undefined,
  });

  return serializeDispute(dispute as DisputeRecord);
}

// ─── Resolve Dispute ────────────────────────────────────────────────

export async function resolveDispute(
  disputeId: string,
  input: ResolveDisputeInput
) {
  const dispute = await prisma.dispute.findUnique({
    where: { disputeId },
    include: {
      participant: true,
      session: true,
    },
  });

  if (!dispute) {
    throw new NotFoundError("Dispute not found");
  }

  if (dispute.status !== "OPEN") {
    throw new ValidationError("Dispute is already resolved or rejected");
  }

  // Validate resolution note
  if (
    input.resolutionNote &&
    input.resolutionNote.length > VALIDATION.resolutionNote.maxLength
  ) {
    throw new ValidationError(
      `Resolution note must be ${VALIDATION.resolutionNote.maxLength} characters or less`
    );
  }

  // For REJECT, resolution note is required
  if (input.resolutionType === "REJECT" && !input.resolutionNote?.trim()) {
    throw new ValidationError(
      "A reason is required when rejecting a dispute"
    );
  }

  // For OVERRIDE, adjusted_total is required
  if (input.resolutionType === "OVERRIDE" && input.adjustedTotal === undefined) {
    throw new ValidationError(
      "An adjusted total is required for override resolution"
    );
  }

  let adjustedTotal: number | null = null;

  if (input.resolutionType === "OVERRIDE" && input.adjustedTotal !== undefined) {
    // Override: directly set the participant's total
    adjustedTotal = input.adjustedTotal;

    await prisma.participant.update({
      where: { participantId: dispute.participantId },
      data: { total: adjustedTotal },
    });
  } else if (input.resolutionType === "ADJUST") {
    // For ADJUST, the host has already modified claims via separate API calls.
    // We just record the new total after modifications.
    const updatedParticipant = await prisma.participant.findUnique({
      where: { participantId: dispute.participantId },
    });
    adjustedTotal = updatedParticipant
      ? toNumber(updatedParticipant.total)
      : null;
  }
  // For REJECT, no total changes

  // Update dispute record
  const resolved = await prisma.dispute.update({
    where: { disputeId },
    data: {
      status: input.status,
      resolutionType: input.resolutionType,
      resolutionNote: input.resolutionNote?.trim() ?? null,
      adjustedTotal: adjustedTotal,
      resolvedAt: new Date(),
    },
  });

  // Transition participant back to REVIEWING
  await transitionParticipant(
    dispute.participantId,
    ParticipantStatus.REVIEWING
  );

  // Recompute session status (may move from DISPUTED to PARTIALLY_SETTLED)
  await recomputeSessionStatus(dispute.sessionId);

  // Send dispute:resolved to the disputing guest
  const isRejected = input.resolutionType === "REJECT";
  try {
    const io = getIO();
    const guestSocketIds = getParticipantSocketIds(
      dispute.sessionId,
      dispute.participantId
    );
    for (const socketId of guestSocketIds) {
      io.to(socketId).emit("dispute:resolved", {
        dispute_id: disputeId,
        participant_id: dispute.participantId,
        status: input.status,
        resolution_type: input.resolutionType,
        resolution_note: input.resolutionNote?.trim() ?? null,
        adjusted_total: adjustedTotal,
        rejected: isRejected,
      });
    }
  } catch {
    // IO not ready
  }

  // Push feed event (neutral, visible to all)
  await pushFeedEvent(dispute.sessionId, {
    type: isRejected ? "dispute_rejected" : "dispute_resolved",
    actor_name: dispute.participant.displayName,
    item_name: undefined,
    amount: undefined,
    claimant_count: undefined,
  });

  // Rebuild state cache
  await buildAndCacheState(dispute.sessionId);

  return serializeDispute(resolved as DisputeRecord);
}

// ─── Query Helpers ──────────────────────────────────────────────────

export async function getDisputeById(disputeId: string) {
  const dispute = await prisma.dispute.findUnique({
    where: { disputeId },
  });

  if (!dispute) {
    throw new NotFoundError("Dispute not found");
  }

  return serializeDispute(dispute as DisputeRecord);
}

export async function getSessionDisputes(sessionId: string) {
  const disputes = await prisma.dispute.findMany({
    where: { sessionId },
    include: { participant: true },
    orderBy: { createdAt: "desc" },
  });

  return disputes.map((d) => ({
    ...serializeDispute(d as DisputeRecord),
    participantName: d.participant.displayName,
  }));
}

export async function getParticipantDisputes(participantId: string) {
  const disputes = await prisma.dispute.findMany({
    where: { participantId },
    orderBy: { createdAt: "desc" },
  });

  return disputes.map((d) => serializeDispute(d as DisputeRecord));
}

export async function getOpenDisputeCount(sessionId: string): Promise<number> {
  return prisma.dispute.count({
    where: { sessionId, status: "OPEN" },
  });
}
