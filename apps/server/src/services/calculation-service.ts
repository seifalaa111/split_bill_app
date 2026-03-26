import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { toNumber, serializeParticipant } from "../lib/serializers";
import {
  calculatePersonalSubtotal,
  splitEqually,
  calculatePersonalTotal,
  calculateRoundingDifference,
  bankersRound,
} from "@splitcheck/shared";
import { ValidationError, NotFoundError } from "./session-service";

type TransactionClient = Prisma.TransactionClient;

export async function checkoutParticipant(participantId: string) {
  return await prisma.$transaction(async (tx: TransactionClient) => {
    const participant = await tx.participant.findUnique({
      where: { participantId },
      include: {
        claims: true,
        session: {
          include: {
            participants: true,
          },
        },
      },
    });

    if (!participant) {
      throw new NotFoundError("Participant not found");
    }

    if (participant.status === "CHECKED_OUT") {
      throw new ValidationError("Already checked out");
    }

    if (participant.claims.length === 0) {
      throw new ValidationError("Cannot checkout without claiming any items");
    }

    const claimAmounts = participant.claims.map(
      (c: { amount: Prisma.Decimal }) => toNumber(c.amount)
    );
    const subtotal = calculatePersonalSubtotal(claimAmounts);

    const allParticipants = participant.session.participants;
    const participantCount = allParticipants.length;

    const taxAmount = toNumber(participant.session.taxAmount);
    const serviceAmount = toNumber(participant.session.serviceAmount);

    const taxShares = splitEqually(taxAmount, participantCount);
    const serviceShares = splitEqually(serviceAmount, participantCount);

    const splitIndex = getSplitIndex(
      allParticipants.map(
        (p: { participantId: string; role: string; joinedAt: Date }) => ({
          participantId: p.participantId,
          role: p.role,
          joinedAt: p.joinedAt,
        })
      ),
      participantId
    );
    const taxShare = taxShares[splitIndex];
    const serviceShare = serviceShares[splitIndex];

    const total = calculatePersonalTotal(subtotal, taxShare, serviceShare);

    const updated = await tx.participant.update({
      where: { participantId },
      data: {
        status: "CHECKED_OUT",
        subtotal,
        taxShare,
        serviceShare,
        total,
        checkedOutAt: new Date(),
      },
    });

    return serializeParticipant(updated);
  });
}

function getSplitIndex(
  participants: { participantId: string; role: string; joinedAt: Date }[],
  targetParticipantId: string
): number {
  const sorted = [...participants].sort((a, b) => {
    if (a.role === "HOST") return -1;
    if (b.role === "HOST") return 1;
    return a.joinedAt.getTime() - b.joinedAt.getTime();
  });

  const index = sorted.findIndex(
    (p) => p.participantId === targetParticipantId
  );
  if (index === -1) {
    throw new Error("Participant not found in session");
  }
  return index;
}

export async function getSessionSummary(sessionId: string) {
  const session = await prisma.session.findUnique({
    where: { sessionId },
    include: {
      items: {
        include: {
          claims: {
            include: {
              participant: {
                select: { displayName: true },
              },
            },
          },
        },
      },
      participants: {
        include: { claims: true },
        orderBy: { joinedAt: "asc" },
      },
    },
  });

  if (!session) {
    throw new NotFoundError("Session not found");
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

  interface ClaimRow {
    claimId: string;
    itemId: string;
    participantId: string;
    quantity: number;
    shareFraction: Prisma.Decimal;
    amount: Prisma.Decimal;
    createdAt: Date;
    participant: { displayName: string };
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

  const participants = (session.participants as ParticipantRow[]).map((p) => ({
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
  }));

  const items = (session.items as ItemRow[]).map((item) => ({
    itemId: item.itemId,
    sessionId: item.sessionId,
    name: item.name,
    quantity: item.quantity,
    unitPrice: toNumber(item.unitPrice),
    lineTotal: toNumber(item.lineTotal),
    isShared: item.isShared,
    claimedQty: item.claimedQty,
    createdAt: item.createdAt.toISOString(),
    claims: item.claims.map((c: ClaimRow) => ({
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

  const checkedOutParticipants = participants.filter(
    (p) => p.status === "CHECKED_OUT"
  );
  const personalTotals = checkedOutParticipants.map((p) => p.total);
  const totalClaimed = bankersRound(
    personalTotals.reduce((sum: number, t: number) => sum + t, 0),
    2
  );

  const billTotal = toNumber(session.billTotal);
  const roundingDifference =
    personalTotals.length > 0
      ? calculateRoundingDifference(billTotal, personalTotals)
      : 0;

  return {
    session: {
      sessionId: session.sessionId,
      sessionCode: session.sessionCode,
      billTotal,
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
    },
    items,
    participants,
    totalClaimed,
    totalRemaining: bankersRound(billTotal - totalClaimed, 2),
    checkoutCount: checkedOutParticipants.length,
    roundingDifference,
  };
}
