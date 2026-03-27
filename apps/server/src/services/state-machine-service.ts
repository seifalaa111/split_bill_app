/**
 * State Machine Service
 *
 * The ONLY code that modifies session.status or participant.status.
 * All other services call this to handle transitions — they never set statuses directly.
 *
 * Responsibilities:
 * 1. Validate every transition against legal transition maps
 * 2. Persist status changes to the database
 * 3. Recompute session status from aggregate participant states
 * 4. Emit WebSocket events + Activity Feed entries on every transition
 * 5. Track status timestamps in Redis for nudge evaluation
 */

import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { redis, RedisKeys, SESSION_CACHE_TTL } from "../lib/redis";
import { toNumber } from "../lib/serializers";
import { buildAndCacheState } from "./state-service";
import { pushFeedEvent } from "./feed-service";
import { getIO } from "../ws/socket-server";
import {
  SessionStatus,
  ParticipantStatus,
  LEGAL_SESSION_TRANSITIONS,
  LEGAL_PARTICIPANT_TRANSITIONS,
  AUTO_CLOSE_DELAY_MS,
} from "@splitcheck/shared";
import { ValidationError } from "./session-service";

// ─── Transition Validation ──────────────────────────────────────────

/**
 * Validates that a status transition is legal. Throws ValidationError if not.
 */
function validateSessionTransition(
  current: string,
  next: SessionStatus
): void {
  const legal = LEGAL_SESSION_TRANSITIONS[current as SessionStatus];
  if (!legal) {
    throw new ValidationError(`Unknown session status: ${current}`);
  }
  if (!legal.includes(next)) {
    throw new ValidationError(
      `Illegal session transition: ${current} → ${next}. Legal targets: [${legal.join(", ")}]`
    );
  }
}

function validateParticipantTransition(
  current: string,
  next: ParticipantStatus
): void {
  const legal = LEGAL_PARTICIPANT_TRANSITIONS[current as ParticipantStatus];
  if (!legal) {
    throw new ValidationError(`Unknown participant status: ${current}`);
  }
  if (!legal.includes(next)) {
    throw new ValidationError(
      `Illegal participant transition: ${current} → ${next}. Legal targets: [${legal.join(", ")}]`
    );
  }
}

// ─── Participant Status Transitions ─────────────────────────────────

interface TransitionParticipantOptions {
  /** Skip WS broadcast (useful when caller will broadcast themselves) */
  skipBroadcast?: boolean;
  /** Skip session recomputation (useful during batch operations) */
  skipSessionRecompute?: boolean;
  /** Prisma transaction client (for transactional operations) */
  tx?: Prisma.TransactionClient;
}

/**
 * Transition a participant to a new status.
 * Validates the transition, updates the database, emits events,
 * and recomputes session status.
 */
export async function transitionParticipant(
  participantId: string,
  newStatus: ParticipantStatus,
  options: TransitionParticipantOptions = {}
): Promise<{ oldStatus: string; newStatus: string; sessionId: string }> {
  const db = options.tx ?? prisma;

  const participant = await db.participant.findUnique({
    where: { participantId },
    include: { session: true },
  });

  if (!participant) {
    throw new ValidationError(`Participant not found: ${participantId}`);
  }

  const oldStatus = participant.status;

  // If already in the target status, no-op
  if (oldStatus === newStatus) {
    return { oldStatus, newStatus, sessionId: participant.sessionId };
  }

  // Validate transition
  validateParticipantTransition(oldStatus, newStatus);

  // Build update data
  const updateData: Prisma.ParticipantUpdateInput = {
    status: newStatus,
  };

  // Set timestamps based on status
  if (newStatus === ParticipantStatus.CHECKED_OUT) {
    updateData.checkedOutAt = new Date();
  }
  if (newStatus === ParticipantStatus.SETTLED) {
    updateData.settledAt = new Date();
  }
  // If reverting from SETTLED, clear settledAt
  if (oldStatus === ParticipantStatus.SETTLED && newStatus !== ParticipantStatus.SETTLED) {
    updateData.settledAt = null;
  }
  // If reverting from CHECKED_OUT to REVIEWING (e.g., reallocation), keep checkedOutAt
  // but if going back further, clear it
  if (
    newStatus === ParticipantStatus.CLAIMING ||
    newStatus === ParticipantStatus.BROWSING
  ) {
    updateData.checkedOutAt = null;
    updateData.settledAt = null;
  }

  await db.participant.update({
    where: { participantId },
    data: updateData,
  });

  // Track status_since in Redis for nudge evaluation
  const statusSinceKey = RedisKeys.participantStatusSince(participantId);
  await redis.set(
    statusSinceKey,
    Date.now().toString(),
    "EX",
    SESSION_CACHE_TTL
  );

  // Emit WebSocket events
  if (!options.skipBroadcast) {
    try {
      const io = getIO();
      const room = `session:${participant.sessionId}`;

      io.to(room).emit("participant:status_changed", {
        participant_id: participantId,
        old_status: oldStatus,
        new_status: newStatus,
      });
    } catch {
      // IO not ready
    }
  }

  // Recompute session status based on aggregate participant states
  if (!options.skipSessionRecompute) {
    await recomputeSessionStatus(participant.sessionId, options.tx);
  }

  return { oldStatus, newStatus, sessionId: participant.sessionId };
}

// ─── Session Status Recomputation ───────────────────────────────────

/**
 * Recompute the correct session status based on aggregate participant states.
 * This is called after every participant status change.
 *
 * Rules:
 * - If any participant is DISPUTED → session is DISPUTED
 * - If all participants are SETTLED → session is SETTLED
 * - If at least one participant is CHECKED_OUT or SETTLED → PARTIALLY_SETTLED
 * - Otherwise, session stays in its current state (OPEN, etc.)
 *
 * Emits session:status_changed if the status actually changes.
 */
export async function recomputeSessionStatus(
  sessionId: string,
  tx?: Prisma.TransactionClient
): Promise<{ oldStatus: string; newStatus: string }> {
  const db = tx ?? prisma;

  const session = await db.session.findUnique({
    where: { sessionId },
    include: {
      participants: true,
      disputes: true,
    },
  });

  if (!session) {
    throw new ValidationError(`Session not found: ${sessionId}`);
  }

  const oldStatus = session.status;

  // Terminal states — don't recompute
  if (oldStatus === SessionStatus.CLOSED || oldStatus === SessionStatus.DRAFT) {
    return { oldStatus, newStatus: oldStatus };
  }

  const participants = session.participants;
  if (participants.length === 0) {
    return { oldStatus, newStatus: oldStatus };
  }

  // Check for open disputes
  const hasOpenDisputes = session.disputes.some(
    (d: { status: string }) => d.status === "OPEN"
  );

  const statuses = participants.map((p: { status: string }) => p.status);

  const allSettled = statuses.every(
    (s: string) => s === ParticipantStatus.SETTLED
  );
  const hasCheckedOutOrSettled = statuses.some(
    (s: string) =>
      s === ParticipantStatus.CHECKED_OUT || s === ParticipantStatus.SETTLED
  );

  let computedStatus: SessionStatus;

  if (hasOpenDisputes) {
    computedStatus = SessionStatus.DISPUTED;
  } else if (allSettled) {
    computedStatus = SessionStatus.SETTLED;
  } else if (hasCheckedOutOrSettled) {
    computedStatus = SessionStatus.PARTIALLY_SETTLED;
  } else {
    // No one has checked out yet — keep at OPEN (or current non-terminal status)
    // If we were DISPUTED but all disputes resolved and no one is checked out,
    // go back to OPEN
    if (oldStatus === SessionStatus.DISPUTED) {
      computedStatus = SessionStatus.OPEN;
    } else {
      computedStatus = oldStatus as SessionStatus;
    }
  }

  // Validate the transition is legal (skip if no change)
  if (computedStatus === oldStatus) {
    return { oldStatus, newStatus: oldStatus };
  }

  // Special case: DISPUTED → OPEN is not in the legal map (brief says DISPUTED → PARTIALLY_SETTLED|SETTLED|CLOSED)
  // If disputes resolve but no one has checked out, we should stay OPEN.
  // This means DISPUTED → OPEN needs to be handled. The brief's transition map doesn't include it,
  // but logically if disputes resolve and nobody is checked out, the session is OPEN.
  // Decision: Allow this by routing through the legal path.
  // If computed is OPEN and old is DISPUTED — this is an edge case.
  // The brief says DISPUTED can go to PARTIALLY_SETTLED, SETTLED, or CLOSED.
  // Since nobody has checked out, PARTIALLY_SETTLED doesn't apply either.
  // Best approach: keep session as OPEN if we came from DISPUTED and no one is checked out.
  // We'll validate only if computedStatus is different from oldStatus.
  try {
    validateSessionTransition(oldStatus, computedStatus);
  } catch {
    // If the computed transition isn't legal, don't change.
    // This handles edge cases like DISPUTED → OPEN which isn't in the map.
    return { oldStatus, newStatus: oldStatus };
  }

  // Persist the new status
  const updateData: { status: string; closedAt?: Date } = {
    status: computedStatus,
  };
  if (computedStatus === SessionStatus.CLOSED) {
    updateData.closedAt = new Date();
  }

  await db.session.update({
    where: { sessionId },
    data: updateData,
  });

  // Emit session:status_changed
  try {
    const io = getIO();
    const room = `session:${sessionId}`;

    io.to(room).emit("session:status_changed", {
      old_status: oldStatus,
      new_status: computedStatus,
    });
  } catch {
    // IO not ready
  }

  // Push feed events for certain transitions
  await emitSessionTransitionFeed(sessionId, oldStatus, computedStatus);

  // If session just reached SETTLED, schedule auto-close
  if (computedStatus === SessionStatus.SETTLED) {
    await scheduleAutoClose(sessionId);
  }

  // If session moved away from SETTLED (shouldn't normally happen, but defensive), cancel auto-close
  if (oldStatus === SessionStatus.SETTLED && computedStatus !== SessionStatus.SETTLED) {
    await cancelAutoClose(sessionId);
  }

  return { oldStatus, newStatus: computedStatus };
}

// ─── Direct Session Transitions (for host-initiated actions) ────────

/**
 * Transition a session to a new status directly.
 * Used for host actions like DRAFT → OPEN and manual close.
 */
export async function transitionSession(
  sessionId: string,
  newStatus: SessionStatus
): Promise<{ oldStatus: string; newStatus: string }> {
  const session = await prisma.session.findUnique({
    where: { sessionId },
  });

  if (!session) {
    throw new ValidationError(`Session not found: ${sessionId}`);
  }

  const oldStatus = session.status;

  if (oldStatus === newStatus) {
    return { oldStatus, newStatus };
  }

  validateSessionTransition(oldStatus, newStatus);

  // Extra validation for specific transitions
  if (oldStatus === SessionStatus.DRAFT && newStatus === SessionStatus.OPEN) {
    // Must have at least 1 item
    const itemCount = await prisma.billItem.count({
      where: { sessionId },
    });
    if (itemCount === 0) {
      throw new ValidationError(
        "Cannot open session without at least 1 item"
      );
    }
  }

  const updateData: { status: string; closedAt?: Date } = {
    status: newStatus,
  };
  if (newStatus === SessionStatus.CLOSED) {
    updateData.closedAt = new Date();
  }

  await prisma.session.update({
    where: { sessionId },
    data: updateData,
  });

  // Emit
  try {
    const io = getIO();
    const room = `session:${sessionId}`;

    io.to(room).emit("session:status_changed", {
      old_status: oldStatus,
      new_status: newStatus,
    });

    if (newStatus === SessionStatus.CLOSED) {
      io.to(room).emit("session:closed", {
        session_id: sessionId,
        reason: "Session closed by host",
      });
    }
  } catch {
    // IO not ready
  }

  await emitSessionTransitionFeed(sessionId, oldStatus, newStatus);

  return { oldStatus, newStatus };
}

// ─── Auto-Close Logic ───────────────────────────────────────────────

/** In-memory timer for auto-close (single-server; use Redis key as distributed lock) */
const autoCloseTimers = new Map<string, NodeJS.Timeout>();

async function scheduleAutoClose(sessionId: string): Promise<void> {
  // Set Redis key as distributed marker
  const key = RedisKeys.autoClose(sessionId);
  await redis.set(key, Date.now().toString(), "EX", Math.ceil(AUTO_CLOSE_DELAY_MS / 1000));

  // Also set in-memory timer for this server instance
  const existing = autoCloseTimers.get(sessionId);
  if (existing) {
    clearTimeout(existing);
  }

  const timer = setTimeout(async () => {
    autoCloseTimers.delete(sessionId);

    try {
      // Verify session is still SETTLED before closing
      const session = await prisma.session.findUnique({
        where: { sessionId },
      });

      if (session && session.status === SessionStatus.SETTLED) {
        await transitionSession(sessionId, SessionStatus.CLOSED);
        await buildAndCacheState(sessionId);
      }
    } catch (err) {
      console.error(`[AutoClose] Failed for session ${sessionId}:`, err);
    }
  }, AUTO_CLOSE_DELAY_MS);

  autoCloseTimers.set(sessionId, timer);
}

async function cancelAutoClose(sessionId: string): Promise<void> {
  const key = RedisKeys.autoClose(sessionId);
  await redis.del(key);

  const timer = autoCloseTimers.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    autoCloseTimers.delete(sessionId);
  }
}

// ─── Feed Emission for Session Transitions ──────────────────────────

async function emitSessionTransitionFeed(
  sessionId: string,
  oldStatus: string,
  newStatus: string
): Promise<void> {
  if (newStatus === SessionStatus.SETTLED) {
    // Don't emit "all_settled" here — it fires when session → CLOSED after the 30s delay
  }

  if (newStatus === SessionStatus.CLOSED) {
    if (oldStatus === SessionStatus.SETTLED) {
      // Auto-close after all settled
      await pushFeedEvent(sessionId, {
        type: "all_settled",
        actor_name: "System",
        item_name: undefined,
        amount: undefined,
        claimant_count: undefined,
      });
    } else {
      // Manual close or TTL expiry
      await pushFeedEvent(sessionId, {
        type: "session_close",
        actor_name: "System",
        item_name: undefined,
        amount: undefined,
        claimant_count: undefined,
      });
    }
  }
}

// ─── Checkout Progress Tracking ─────────────────────────────────────

/**
 * Evaluate and emit checkout progress milestones after a checkout.
 * Called after a participant checks out.
 */
export async function evaluateCheckoutProgress(
  sessionId: string
): Promise<void> {
  const participants = await prisma.participant.findMany({
    where: { sessionId },
  });

  const total = participants.length;
  if (total === 0) return;

  const checkedOutOrSettled = participants.filter(
    (p: { status: string }) =>
      p.status === ParticipantStatus.CHECKED_OUT ||
      p.status === ParticipantStatus.SETTLED
  ).length;

  const ratio = checkedOutOrSettled / total;
  const remaining = total - checkedOutOrSettled;

  // Milestone: 50% checked out (emit once when we cross the threshold)
  if (ratio >= 0.5 && ratio < 1) {
    // Check if we should emit the 50% message
    // Only emit if we just crossed 50% (previous count was below 50%)
    const previousCount = checkedOutOrSettled - 1; // The one that just checked out
    const previousRatio = previousCount / total;

    if (previousRatio < 0.5) {
      await pushFeedEvent(sessionId, {
        type: "progress_50",
        actor_name: "System",
        item_name: undefined,
        amount: total,
        claimant_count: checkedOutOrSettled,
      });
    }
  }

  // Milestone: almost done (1 remaining)
  if (remaining === 1 && total > 1) {
    await pushFeedEvent(sessionId, {
      type: "progress_almost",
      actor_name: "System",
      item_name: undefined,
      amount: undefined,
      claimant_count: remaining,
    });
  }

  // Milestone: all checked out
  if (remaining === 0) {
    await pushFeedEvent(sessionId, {
      type: "progress_complete",
      actor_name: "System",
      item_name: undefined,
      amount: undefined,
      claimant_count: checkedOutOrSettled,
    });
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Get the timestamp when a participant entered their current status.
 * Used by the nudge service to evaluate time-based triggers.
 */
export async function getParticipantStatusSince(
  participantId: string
): Promise<number | null> {
  const key = RedisKeys.participantStatusSince(participantId);
  const value = await redis.get(key);
  return value ? parseInt(value, 10) : null;
}
