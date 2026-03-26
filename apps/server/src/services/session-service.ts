import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { generateUniqueSessionCode } from "../lib/code-generator";
import { toNumber, serializeSession } from "../lib/serializers";
import {
  calculateSessionTotals,
  SESSION_EXPIRY_HOURS,
  SessionStatus,
  VALIDATION,
} from "@splitcheck/shared";

interface CreateSessionInput {
  billTotal: number;
  taxPct: number;
  servicePct: number;
  expectedHeadcount: number;
}

export async function createSession(input: CreateSessionInput) {
  validateCreateSessionInput(input);

  const sessionCode = await generateUniqueSessionCode();
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + SESSION_EXPIRY_HOURS);

  const session = await prisma.session.create({
    data: {
      sessionCode,
      billTotal: input.billTotal,
      billSubtotal: 0,
      taxPct: input.taxPct,
      servicePct: input.servicePct,
      taxAmount: 0,
      serviceAmount: 0,
      expectedHeadcount: input.expectedHeadcount,
      status: SessionStatus.DRAFT,
      expiresAt,
    },
  });

  return serializeSession(session);
}

export async function getSessionByCode(code: string) {
  const normalizedCode = code.toUpperCase().trim();

  if (!VALIDATION.sessionCode.pattern.test(normalizedCode)) {
    throw new ValidationError("Invalid session code format");
  }

  const session = await prisma.session.findUnique({
    where: { sessionCode: normalizedCode },
    include: {
      items: { include: { claims: true } },
      participants: true,
    },
  });

  if (!session) {
    throw new NotFoundError("Session not found");
  }

  interface ClaimRow {
    claimId: string;
    itemId: string;
    participantId: string;
    quantity: number;
    shareFraction: Prisma.Decimal;
    amount: Prisma.Decimal;
    createdAt: Date;
  }

  interface ItemRow {
    itemId: string;
    sessionId: string;
    name: string;
    quantity: number;
    unitPrice: Prisma.Decimal;
    lineTotal: Prisma.Decimal;
    isShared: boolean;
    claimedQty: number;
    createdAt: Date;
    claims: ClaimRow[];
  }

  interface ParticipantRow {
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
  }

  return {
    ...serializeSession(session),
    items: (session.items as ItemRow[]).map((item) => ({
      itemId: item.itemId,
      sessionId: item.sessionId,
      name: item.name,
      quantity: item.quantity,
      unitPrice: toNumber(item.unitPrice),
      lineTotal: toNumber(item.lineTotal),
      isShared: item.isShared,
      claimedQty: item.claimedQty,
      createdAt: item.createdAt.toISOString(),
      claims: item.claims.map((claim: ClaimRow) => ({
        claimId: claim.claimId,
        itemId: claim.itemId,
        participantId: claim.participantId,
        quantity: claim.quantity,
        shareFraction: toNumber(claim.shareFraction),
        amount: toNumber(claim.amount),
        createdAt: claim.createdAt.toISOString(),
      })),
    })),
    participants: (session.participants as ParticipantRow[]).map((p) => ({
      participantId: p.participantId,
      sessionId: p.sessionId,
      displayName: p.displayName,
      role: p.role,
      status: p.status,
      subtotal: toNumber(p.subtotal),
      taxShare: toNumber(p.taxShare),
      serviceShare: toNumber(p.serviceShare),
      total: toNumber(p.total),
      joinedAt: p.joinedAt.toISOString(),
      checkedOutAt: p.checkedOutAt?.toISOString() ?? null,
    })),
  };
}

export async function getSessionById(sessionId: string) {
  const session = await prisma.session.findUnique({
    where: { sessionId },
  });

  if (!session) {
    throw new NotFoundError("Session not found");
  }

  return serializeSession(session);
}

export async function updateSessionStatus(
  sessionId: string,
  status: string
) {
  const validStatuses = [
    SessionStatus.DRAFT,
    SessionStatus.OPEN,
    SessionStatus.CLOSED,
  ];
  if (!validStatuses.includes(status as SessionStatus)) {
    throw new ValidationError(
      `Invalid status. Must be one of: ${validStatuses.join(", ")}`
    );
  }

  const session = await prisma.session.findUnique({
    where: { sessionId },
  });

  if (!session) {
    throw new NotFoundError("Session not found");
  }

  const currentStatus = session.status;
  if (currentStatus === SessionStatus.DRAFT && status !== SessionStatus.OPEN) {
    throw new ValidationError("DRAFT sessions can only transition to OPEN");
  }
  if (currentStatus === SessionStatus.OPEN && status !== SessionStatus.CLOSED) {
    throw new ValidationError("OPEN sessions can only transition to CLOSED");
  }
  if (currentStatus === SessionStatus.CLOSED) {
    throw new ValidationError("CLOSED sessions cannot change status");
  }

  const updateData: { status: string; closedAt?: Date } = { status };
  if (status === SessionStatus.CLOSED) {
    updateData.closedAt = new Date();
  }

  const updated = await prisma.session.update({
    where: { sessionId },
    data: updateData,
  });

  return serializeSession(updated);
}

export async function recalculateSessionTotals(sessionId: string) {
  const items = await prisma.billItem.findMany({
    where: { sessionId },
  });

  const billSubtotal = items.reduce(
    (sum: number, item: { lineTotal: Prisma.Decimal }) =>
      sum + toNumber(item.lineTotal),
    0
  );

  const session = await prisma.session.findUnique({
    where: { sessionId },
    select: { taxPct: true, servicePct: true },
  });

  if (!session) {
    throw new NotFoundError("Session not found");
  }

  const { taxAmount, serviceAmount } = calculateSessionTotals(
    billSubtotal,
    toNumber(session.taxPct),
    toNumber(session.servicePct)
  );

  const updated = await prisma.session.update({
    where: { sessionId },
    data: {
      billSubtotal,
      taxAmount,
      serviceAmount,
    },
  });

  return serializeSession(updated);
}

function validateCreateSessionInput(input: CreateSessionInput) {
  if (input.billTotal < VALIDATION.billTotal.min) {
    throw new ValidationError("Bill total must be greater than 0");
  }
  if (
    input.taxPct < VALIDATION.taxPercent.min ||
    input.taxPct > VALIDATION.taxPercent.max
  ) {
    throw new ValidationError("Tax percentage must be between 0 and 100");
  }
  if (
    input.servicePct < VALIDATION.servicePercent.min ||
    input.servicePct > VALIDATION.servicePercent.max
  ) {
    throw new ValidationError("Service percentage must be between 0 and 100");
  }
  if (
    !Number.isInteger(input.expectedHeadcount) ||
    input.expectedHeadcount < VALIDATION.expectedHeadcount.min
  ) {
    throw new ValidationError("Expected headcount must be at least 2");
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}
