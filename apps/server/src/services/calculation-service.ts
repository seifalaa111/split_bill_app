import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { toNumber, serializeParticipant } from "../lib/serializers";
import {
  calculatePersonalSubtotal,
  splitEqually,
  calculatePersonalTotal,
  calculateRoundingDifference,
  bankersRound,
  ParticipantStatus,
} from "@splitcheck/shared";
import { ValidationError, NotFoundError } from "./session-service";
import { transitionParticipant } from "./state-machine-service";

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

    // Validate status — can only checkout from CLAIMING or REVIEWING
    const checkoutableStatuses: string[] = [
      ParticipantStatus.CLAIMING,
      ParticipantStatus.REVIEWING,
    ];
    if (!checkoutableStatuses.includes(participant.status)) {
      if (participant.status === ParticipantStatus.CHECKED_OUT) {
        throw new ValidationError("Already checked out");
      }
      throw new ValidationError("Cannot checkout from current status");
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

    // Update financial fields (status will be set by state machine)
    await tx.participant.update({
      where: { participantId },
      data: {
        subtotal,
        taxShare,
        serviceShare,
        total,
      },
    });

    // Transition status via state machine
    // If coming from CLAIMING, we need to go through REVIEWING first
    if (participant.status === ParticipantStatus.CLAIMING) {
      await transitionParticipant(participantId, ParticipantStatus.REVIEWING, {
        tx,
        skipBroadcast: true,
        skipSessionRecompute: true,
      });
    }
    await transitionParticipant(participantId, ParticipantStatus.CHECKED_OUT, {
      tx,
      skipBroadcast: true,  // caller will broadcast
      skipSessionRecompute: false,  // trigger session state recomputation
    });

    // Re-fetch to get updated record
    const updated = await tx.participant.findUnique({
      where: { participantId },
    });

    if (!updated) {
      throw new NotFoundError("Participant not found after update");
    }

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
    settledAt: Date | null;
    avatarColor: string;
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
    absorbedByHost: boolean;
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
    settledAt: p.settledAt?.toISOString() ?? null,
    avatarColor: p.avatarColor,
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
    absorbedByHost: item.absorbedByHost,
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

  // Count participants who have completed checkout (CHECKED_OUT, DISPUTED, or SETTLED)
  const completedParticipants = participants.filter(
    (p) =>
      p.status === ParticipantStatus.CHECKED_OUT ||
      p.status === ParticipantStatus.DISPUTED ||
      p.status === ParticipantStatus.SETTLED
  );
  const personalTotals = completedParticipants.map((p) => p.total);
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
    checkoutCount: completedParticipants.length,
    roundingDifference,
  };
}
