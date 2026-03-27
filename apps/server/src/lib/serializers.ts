import { Prisma } from "@prisma/client";

/**
 * Convert Prisma Decimal to number.
 * Prisma returns Decimal objects for DECIMAL columns — these need explicit conversion.
 */
export function toNumber(value: Prisma.Decimal | number | string): number {
  if (typeof value === "number") return value;
  return Number(value);
}

/**
 * Convert a Prisma model with Decimal fields to plain number fields.
 * Used when serializing to API responses.
 */
export function serializeSession(session: {
  sessionId: string;
  sessionCode: string;
  billTotal: Prisma.Decimal;
  billSubtotal: Prisma.Decimal;
  taxPct: Prisma.Decimal;
  servicePct: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  serviceAmount: Prisma.Decimal;
  expectedHeadcount: number;
  status: string;
  createdAt: Date;
  expiresAt: Date;
  closedAt: Date | null;
}) {
  return {
    sessionId: session.sessionId,
    sessionCode: session.sessionCode,
    billTotal: toNumber(session.billTotal),
    billSubtotal: toNumber(session.billSubtotal),
    taxPct: toNumber(session.taxPct),
    servicePct: toNumber(session.servicePct),
    taxAmount: toNumber(session.taxAmount),
    serviceAmount: toNumber(session.serviceAmount),
    expectedHeadcount: session.expectedHeadcount,
    status: session.status,
    createdAt: session.createdAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    closedAt: session.closedAt?.toISOString() ?? null,
  };
}

export function serializeItem(item: {
  itemId: string;
  sessionId: string;
  name: string;
  quantity: number;
  unitPrice: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
  isShared: boolean;
  claimedQty: number;
  absorbedByHost: boolean;
  createdAt: Date;
}) {
  return {
    itemId: item.itemId,
    sessionId: item.sessionId,
    name: item.name,
    quantity: item.quantity,
    unitPrice: toNumber(item.unitPrice),
    lineTotal: toNumber(item.lineTotal),
    isShared: item.isShared,
    claimedQty: item.claimedQty,
    absorbedByHost: item.absorbedByHost,
    createdAt: item.createdAt.toISOString(),
  };
}

export function serializeParticipant(participant: {
  participantId: string;
  sessionId: string;
  displayName: string;
  role: string;
  status: string;
  subtotal: Prisma.Decimal;
  taxShare: Prisma.Decimal;
  serviceShare: Prisma.Decimal;
  total: Prisma.Decimal;
  joinedAt: Date;
  checkedOutAt: Date | null;
  settledAt: Date | null;
  avatarColor: string;
}) {
  return {
    participantId: participant.participantId,
    sessionId: participant.sessionId,
    displayName: participant.displayName,
    role: participant.role,
    status: participant.status,
    subtotal: toNumber(participant.subtotal),
    taxShare: toNumber(participant.taxShare),
    serviceShare: toNumber(participant.serviceShare),
    total: toNumber(participant.total),
    joinedAt: participant.joinedAt.toISOString(),
    checkedOutAt: participant.checkedOutAt?.toISOString() ?? null,
    settledAt: participant.settledAt?.toISOString() ?? null,
    avatarColor: participant.avatarColor,
  };
}

export function serializeClaim(claim: {
  claimId: string;
  itemId: string;
  participantId: string;
  quantity: number;
  shareFraction: Prisma.Decimal;
  amount: Prisma.Decimal;
  createdAt: Date;
}) {
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
