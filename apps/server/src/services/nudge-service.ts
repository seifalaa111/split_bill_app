/**
 * Nudge Service
 *
 * Computes and delivers nudges — server-computed, client-displayed visual banners
 * that encourage stragglers to complete checkout.
 *
 * Nudges are:
 * - Targeted to specific participants (NOT broadcast)
 * - Ephemeral (not stored in DB)
 * - Max 1 visible at a time (new replaces old)
 * - Dismissible (tracked client-side)
 * - Never push notifications, never sounds, never blocking modals
 */

import { prisma } from "../lib/prisma";
import { getIO, getParticipantSocketIds } from "../ws/socket-server";
import { getParticipantStatusSince } from "./state-machine-service";
import {
  ParticipantStatus,
  NUDGE_STALE_CLAIMING_MS,
  NUDGE_STALE_BROWSING_MS,
} from "@splitcheck/shared";
import type { NudgeShowPayload } from "@splitcheck/shared";

// ─── Nudge ID Generation ────────────────────────────────────────────

function makeNudgeId(trigger: string, sessionId: string, participantId: string): string {
  return `${trigger}:${sessionId}:${participantId}`;
}

// ─── Send Nudge to Specific Participant ─────────────────────────────

function sendNudge(
  sessionId: string,
  participantId: string,
  payload: NudgeShowPayload
): void {
  try {
    const io = getIO();
    const socketIds = getParticipantSocketIds(sessionId, participantId);
    for (const socketId of socketIds) {
      io.to(socketId).emit("nudge:show", payload);
    }
  } catch {
    // IO not ready
  }
}

// ─── Checkout-Based Nudge Evaluation (N1, N2, N3) ──────────────────

/**
 * Called after every checkout event.
 * Evaluates nudge triggers N1 (50%), N2 (2-3 remaining), N3 (1 remaining).
 */
export async function evaluateCheckoutNudges(sessionId: string): Promise<void> {
  const participants = await prisma.participant.findMany({
    where: { sessionId },
  });

  const total = participants.length;
  if (total <= 1) return;

  const checkedOutOrSettled = participants.filter(
    (p) =>
      p.status === ParticipantStatus.CHECKED_OUT ||
      p.status === ParticipantStatus.SETTLED
  );

  const notCheckedOut = participants.filter(
    (p) =>
      p.status !== ParticipantStatus.CHECKED_OUT &&
      p.status !== ParticipantStatus.SETTLED &&
      p.status !== ParticipantStatus.DISPUTED
  );

  const checkedCount = checkedOutOrSettled.length;
  const remaining = notCheckedOut.length;

  if (remaining === 0) return;

  // N3: All checked out except 1
  if (remaining === 1 && checkedCount >= 2) {
    const target = notCheckedOut[0];
    sendNudge(sessionId, target.participantId, {
      nudge_id: makeNudgeId("N3", sessionId, target.participantId),
      message: "Everyone is done except you 👀",
      priority: "high",
    });
    return; // N3 takes priority — don't send N1 or N2
  }

  // N2: All checked out except 2-3
  if (remaining >= 2 && remaining <= 3 && checkedCount >= 1) {
    for (const target of notCheckedOut) {
      sendNudge(sessionId, target.participantId, {
        nudge_id: makeNudgeId("N2", sessionId, target.participantId),
        message: `Almost there — ${remaining} people still deciding.`,
        priority: "medium",
      });
    }
    return; // N2 takes priority over N1
  }

  // N1: 50% of guests have checked out
  const ratio = checkedCount / total;
  if (ratio >= 0.5) {
    for (const target of notCheckedOut) {
      sendNudge(sessionId, target.participantId, {
        nudge_id: makeNudgeId("N1", sessionId, target.participantId),
        message: `⏳ ${checkedCount} out of ${total} have checked out.`,
        priority: "low",
      });
    }
  }
}

// ─── Time-Based Nudge Evaluation (N4, N5) ───────────────────────────

/**
 * Called periodically (every 60 seconds) by the socket server interval.
 * Evaluates nudge triggers N4 (stale CLAIMING) and N5 (stale BROWSING).
 */
export async function evaluateTimeBasedNudges(sessionId: string): Promise<void> {
  const participants = await prisma.participant.findMany({
    where: { sessionId },
  });

  const now = Date.now();

  for (const p of participants) {
    // N4: Guest in CLAIMING for > 5 minutes
    if (p.status === ParticipantStatus.CLAIMING) {
      const statusSince = await getParticipantStatusSince(p.participantId);
      if (statusSince && now - statusSince > NUDGE_STALE_CLAIMING_MS) {
        sendNudge(sessionId, p.participantId, {
          nudge_id: makeNudgeId("N4", sessionId, p.participantId),
          message: "Take your time — but your items are locked in whenever you're ready ✅",
          priority: "low",
        });
      }
    }

    // N5: Guest in BROWSING for > 3 minutes (0 claims)
    if (p.status === ParticipantStatus.BROWSING) {
      const statusSince = await getParticipantStatusSince(p.participantId);
      if (statusSince && now - statusSince > NUDGE_STALE_BROWSING_MS) {
        sendNudge(sessionId, p.participantId, {
          nudge_id: makeNudgeId("N5", sessionId, p.participantId),
          message: "Need help? Tap the items you ate to get started.",
          priority: "low",
        });
      }
    }
  }
}
