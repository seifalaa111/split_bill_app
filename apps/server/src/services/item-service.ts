import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { serializeItem, toNumber } from "../lib/serializers";
import { calculateLineTotal, VALIDATION } from "@splitcheck/shared";
import { ValidationError, NotFoundError, recalculateSessionTotals } from "./session-service";

interface AddItemInput {
  name: string;
  quantity: number;
  unitPrice: number;
  isShared: boolean;
}

interface UpdateItemInput {
  name?: string;
  quantity?: number;
  unitPrice?: number;
  isShared?: boolean;
}

export async function addItem(sessionId: string, input: AddItemInput) {
  validateItemInput(input);

  const session = await prisma.session.findUnique({
    where: { sessionId },
  });

  if (!session) {
    throw new NotFoundError("Session not found");
  }

  if (session.status !== "DRAFT") {
    throw new ValidationError("Can only add items to DRAFT sessions");
  }

  const lineTotal = calculateLineTotal(input.quantity, input.unitPrice);

  const item = await prisma.billItem.create({
    data: {
      sessionId,
      name: input.name.trim(),
      quantity: input.quantity,
      unitPrice: input.unitPrice,
      lineTotal,
      isShared: input.isShared,
    },
  });

  await recalculateSessionTotals(sessionId);

  return serializeItem(item);
}

export async function updateItem(itemId: string, input: UpdateItemInput) {
  const item = await prisma.billItem.findUnique({
    where: { itemId },
    include: { session: true },
  });

  if (!item) {
    throw new NotFoundError("Item not found");
  }

  if (item.session.status !== "DRAFT") {
    throw new ValidationError("Can only edit items in DRAFT sessions");
  }

  const name = input.name !== undefined ? input.name.trim() : item.name;
  const quantity = input.quantity !== undefined ? input.quantity : item.quantity;
  const unitPrice = input.unitPrice !== undefined ? input.unitPrice : toNumber(item.unitPrice);
  const isShared = input.isShared !== undefined ? input.isShared : item.isShared;

  validateItemInput({ name, quantity, unitPrice, isShared });

  const lineTotal = calculateLineTotal(quantity, unitPrice);

  const updated = await prisma.billItem.update({
    where: { itemId },
    data: {
      name,
      quantity,
      unitPrice,
      lineTotal,
      isShared,
    },
  });

  await recalculateSessionTotals(item.sessionId);

  return serializeItem(updated);
}

export async function deleteItem(itemId: string) {
  const item = await prisma.billItem.findUnique({
    where: { itemId },
    include: { session: true, claims: true },
  });

  if (!item) {
    throw new NotFoundError("Item not found");
  }

  if (item.session.status !== "DRAFT") {
    throw new ValidationError("Can only delete items in DRAFT sessions");
  }

  if (item.claims.length > 0) {
    await prisma.claim.deleteMany({ where: { itemId } });
  }

  await prisma.billItem.delete({ where: { itemId } });

  await recalculateSessionTotals(item.sessionId);

  return { deleted: true };
}

interface ClaimWithParticipant {
  claimId: string;
  itemId: string;
  participantId: string;
  quantity: number;
  shareFraction: Prisma.Decimal;
  amount: Prisma.Decimal;
  createdAt: Date;
  participant: { displayName: string };
}

interface ItemWithClaims {
  itemId: string;
  sessionId: string;
  name: string;
  quantity: number;
  unitPrice: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
  isShared: boolean;
  claimedQty: number;
  createdAt: Date;
  claims: ClaimWithParticipant[];
}

export async function getSessionItems(sessionId: string) {
  const session = await prisma.session.findUnique({
    where: { sessionId },
  });

  if (!session) {
    throw new NotFoundError("Session not found");
  }

  const items = await prisma.billItem.findMany({
    where: { sessionId },
    include: {
      claims: {
        include: {
          participant: {
            select: { displayName: true },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return (items as ItemWithClaims[]).map((item) => ({
    ...serializeItem(item),
    claims: item.claims.map((c: ClaimWithParticipant) => ({
      claimId: c.claimId,
      itemId: c.itemId,
      participantId: c.participantId,
      quantity: c.quantity,
      shareFraction: toNumber(c.shareFraction),
      amount: toNumber(c.amount),
      createdAt: c.createdAt.toISOString(),
      participantName: c.participant.displayName,
    })),
  }));
}

function validateItemInput(input: AddItemInput) {
  if (!input.name || input.name.trim().length < VALIDATION.itemName.minLength) {
    throw new ValidationError("Item name is required");
  }
  if (input.name.trim().length > VALIDATION.itemName.maxLength) {
    throw new ValidationError(`Item name must be ${VALIDATION.itemName.maxLength} characters or less`);
  }
  if (!Number.isInteger(input.quantity) || input.quantity < VALIDATION.itemQuantity.min) {
    throw new ValidationError("Item quantity must be at least 1");
  }
  if (input.unitPrice < VALIDATION.itemUnitPrice.min) {
    throw new ValidationError("Unit price must be 0 or greater");
  }
}
