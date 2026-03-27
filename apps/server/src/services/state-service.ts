import { redis, RedisKeys, SESSION_CACHE_TTL } from "../lib/redis";
import { prisma } from "../lib/prisma";
import { toNumber } from "../lib/serializers";
import { Prisma } from "@prisma/client";
import type {
  StateSyncPayload,
  SessionSnapshot,
  ItemSnapshot,
  ParticipantSnapshot,
  ClaimSnapshot,
} from "@splitcheck/shared";

/**
 * Build a full state snapshot from the database and cache it in Redis.
 * Returns the snapshot for immediate use.
 */
export async function buildAndCacheState(
  sessionId: string
): Promise<StateSyncPayload> {
  const session = await prisma.session.findUnique({
    where: { sessionId },
    include: {
      items: {
        include: {
          claims: {
            include: {
              participant: { select: { displayName: true } },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
      participants: {
        orderBy: { joinedAt: "asc" },
      },
    },
  });

  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const sessionSnapshot: SessionSnapshot = {
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

  interface PrismaClaimWithParticipant {
    claimId: string;
    itemId: string;
    participantId: string;
    quantity: number;
    shareFraction: Prisma.Decimal;
    amount: Prisma.Decimal;
    createdAt: Date;
    participant: { displayName: string };
  }

  interface PrismaItem {
    itemId: string;
    sessionId: string;
    name: string;
    quantity: number;
    unitPrice: Prisma.Decimal;
    lineTotal: Prisma.Decimal;
    isShared: boolean;
    claimedQty: number;
    createdAt: Date;
    claims: PrismaClaimWithParticipant[];
  }

  interface PrismaParticipant {
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
    avatarColor: string;
  }

  const items: ItemSnapshot[] = (session.items as PrismaItem[]).map((item) => ({
    itemId: item.itemId,
    sessionId: item.sessionId,
    name: item.name,
    quantity: item.quantity,
    unitPrice: toNumber(item.unitPrice),
    lineTotal: toNumber(item.lineTotal),
    isShared: item.isShared,
    claimedQty: item.claimedQty,
    createdAt: item.createdAt.toISOString(),
  }));

  const participants: ParticipantSnapshot[] = (
    session.participants as PrismaParticipant[]
  ).map((p) => ({
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
    avatarColor: p.avatarColor,
  }));

  const claims: ClaimSnapshot[] = (session.items as PrismaItem[]).flatMap(
    (item) =>
      item.claims.map((c) => ({
        claimId: c.claimId,
        itemId: c.itemId,
        participantId: c.participantId,
        quantity: c.quantity,
        shareFraction: toNumber(c.shareFraction),
        amount: toNumber(c.amount),
        createdAt: c.createdAt.toISOString(),
        participantName: c.participant.displayName,
      }))
  );

  const payload: StateSyncPayload = {
    session: sessionSnapshot,
    items,
    participants,
    claims,
  };

  // Cache in Redis
  const key = RedisKeys.sessionState(sessionId);
  await redis.set(key, JSON.stringify(payload), "EX", SESSION_CACHE_TTL);

  return payload;
}

/**
 * Get cached state from Redis, or rebuild from DB if cache miss.
 */
export async function getCachedState(
  sessionId: string
): Promise<StateSyncPayload> {
  const key = RedisKeys.sessionState(sessionId);
  const cached = await redis.get(key);

  if (cached) {
    return JSON.parse(cached) as StateSyncPayload;
  }

  return buildAndCacheState(sessionId);
}

/**
 * Invalidate the cached state — forces a rebuild on next read.
 */
export async function invalidateStateCache(sessionId: string): Promise<void> {
  const key = RedisKeys.sessionState(sessionId);
  await redis.del(key);
}
