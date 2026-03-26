export const SessionStatus = {
  DRAFT: "DRAFT",
  OPEN: "OPEN",
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
  CHECKED_OUT: "CHECKED_OUT",
} as const;
export type ParticipantStatus =
  (typeof ParticipantStatus)[keyof typeof ParticipantStatus];

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
} as const;
