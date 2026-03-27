export const SessionStatus = {
  DRAFT: "DRAFT",
  OPEN: "OPEN",
  PARTIALLY_SETTLED: "PARTIALLY_SETTLED",
  DISPUTED: "DISPUTED",
  SETTLED: "SETTLED",
  CLOSED: "CLOSED",
} as const;
export type SessionStatus = (typeof SessionStatus)[keyof typeof SessionStatus];

export const ParticipantRole = {
  HOST: "HOST",
  GUEST: "GUEST",
} as const;
export type ParticipantRole = (typeof ParticipantRole)[keyof typeof ParticipantRole];

export const ParticipantStatus = {
  BROWSING: "BROWSING",
  CLAIMING: "CLAIMING",
  REVIEWING: "REVIEWING",
  CHECKED_OUT: "CHECKED_OUT",
  DISPUTED: "DISPUTED",
  SETTLED: "SETTLED",
} as const;
export type ParticipantStatus =
  (typeof ParticipantStatus)[keyof typeof ParticipantStatus];

export const DisputeStatus = {
  OPEN: "OPEN",
  RESOLVED: "RESOLVED",
  REJECTED: "REJECTED",
} as const;
export type DisputeStatus = (typeof DisputeStatus)[keyof typeof DisputeStatus];

export const ResolutionType = {
  ADJUST: "ADJUST",
  REJECT: "REJECT",
  OVERRIDE: "OVERRIDE",
} as const;
export type ResolutionType =
  (typeof ResolutionType)[keyof typeof ResolutionType];

export const NudgePriority = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
} as const;
export type NudgePriority = (typeof NudgePriority)[keyof typeof NudgePriority];

// ─── State Machine Transition Maps ──────────────────────────────────

export const LEGAL_SESSION_TRANSITIONS: Record<SessionStatus, SessionStatus[]> = {
  DRAFT:              ["OPEN", "CLOSED"],
  OPEN:               ["PARTIALLY_SETTLED", "DISPUTED", "CLOSED"],
  PARTIALLY_SETTLED:  ["SETTLED", "DISPUTED", "CLOSED"],
  DISPUTED:           ["PARTIALLY_SETTLED", "SETTLED", "CLOSED"],
  SETTLED:            ["CLOSED"],
  CLOSED:             [],
};

export const LEGAL_PARTICIPANT_TRANSITIONS: Record<ParticipantStatus, ParticipantStatus[]> = {
  BROWSING:     ["CLAIMING"],
  CLAIMING:     ["BROWSING", "REVIEWING"],
  REVIEWING:    ["CLAIMING", "CHECKED_OUT", "DISPUTED"],
  CHECKED_OUT:  ["DISPUTED", "SETTLED", "REVIEWING"],
  DISPUTED:     ["REVIEWING"],
  SETTLED:      ["REVIEWING"],
};

// ─── Dispute & Nudge Constants ──────────────────────────────────────

export const MAX_DISPUTES_PER_PARTICIPANT = 3;
export const AUTO_CLOSE_DELAY_MS = 30_000;
export const NUDGE_STALE_CLAIMING_MS = 5 * 60 * 1000;  // 5 minutes
export const NUDGE_STALE_BROWSING_MS = 3 * 60 * 1000;  // 3 minutes
export const NUDGE_CHECK_INTERVAL_MS = 60_000;          // 60 seconds

export const SESSION_CODE_LENGTH = 6;
export const SESSION_EXPIRY_HOURS = 4;
export const ROUNDING_TOLERANCE_EGP = 0.1;

export const VALIDATION = {
  billTotal: { min: 0.01, maxDigits: 10, maxDecimals: 2 },
  taxPercent: { min: 0, max: 100, maxDecimals: 2 },
  servicePercent: { min: 0, max: 100, maxDecimals: 2 },
  expectedHeadcount: { min: 2 },
  itemName: { minLength: 1, maxLength: 60 },
  itemQuantity: { min: 1 },
  itemUnitPrice: { min: 0, maxDecimals: 2 },
  displayName: { minLength: 1, maxLength: 30 },
  sessionCode: { length: 6, pattern: /^[A-Z0-9]{6}$/ },
  disputeReason: { minLength: 1, maxLength: 200 },
  resolutionNote: { maxLength: 200 },
} as const;
