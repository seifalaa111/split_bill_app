import { redis, RedisKeys, SESSION_CACHE_TTL } from "../lib/redis";
import { getIO } from "../ws/socket-server";
import type { FeedEventPayload, FeedEventType } from "@splitcheck/shared";

interface FeedEventInput {
  type: FeedEventType;
  actor_name: string;
  item_name: string | undefined;
  amount: number | undefined;
  claimant_count: number | undefined;
}

interface BufferedClaim {
  item_name: string;
  timestamp: number;
}

// ─── Premium Item Detection ──────────────────────────────────────────

/**
 * Calculate and cache the premium price threshold for a session.
 * Premium = top 20% by unit_price. Called once when session transitions to OPEN.
 */
export async function cachePremiumThreshold(
  sessionId: string,
  unitPrices: number[]
): Promise<void> {
  if (unitPrices.length === 0) return;

  const sorted = [...unitPrices].sort((a, b) => a - b);
  const index = Math.ceil(sorted.length * 0.8) - 1;
  const threshold = sorted[Math.max(0, index)];

  const key = RedisKeys.premiumThreshold(sessionId);
  await redis.set(key, threshold.toString(), "EX", SESSION_CACHE_TTL);
}

async function getPremiumThreshold(sessionId: string): Promise<number> {
  const key = RedisKeys.premiumThreshold(sessionId);
  const value = await redis.get(key);
  return value ? parseFloat(value) : Infinity;
}

async function isItemPremium(
  sessionId: string,
  itemName: string
): Promise<boolean> {
  // We need the item's unit price — look it up from cached state
  const stateKey = RedisKeys.sessionState(sessionId);
  const cached = await redis.get(stateKey);
  if (!cached) return false;

  const state = JSON.parse(cached);
  const item = state.items?.find(
    (i: { name: string }) => i.name === itemName
  );
  if (!item) return false;

  const threshold = await getPremiumThreshold(sessionId);
  return item.unitPrice >= threshold;
}

// ─── Message Template Engine ─────────────────────────────────────────

async function buildFeedMessage(
  sessionId: string,
  input: FeedEventInput
): Promise<{ message: string; emoji: string }> {
  switch (input.type) {
    case "join":
      return {
        message: `${input.actor_name} just joined the table.`,
        emoji: "👋",
      };

    case "claim": {
      const name = input.item_name ?? "an item";
      const count = input.claimant_count ?? 1;

      if (count >= 3) {
        return {
          message: `${count} people fighting over ${name}!`,
          emoji: "🍟",
        };
      }
      if (count === 2) {
        return {
          message: `${input.actor_name} wants a piece of the ${name} — ${count} sharing now.`,
          emoji: "🤝",
        };
      }

      // Single claimant — check if premium
      const premium = await isItemPremium(sessionId, name);
      if (premium) {
        return {
          message: `${input.actor_name} went straight for the ${name}.`,
          emoji: "👀",
        };
      }
      return {
        message: `${input.actor_name} grabbed the ${name}.`,
        emoji: "🍽️",
      };
    }

    case "unclaim":
      return {
        message: `${input.actor_name} put back the ${input.item_name ?? "an item"}.`,
        emoji: "😅",
      };

    case "checkout":
      return {
        message: `${input.actor_name} checked out! EGP ${(input.amount ?? 0).toFixed(2)}.`,
        emoji: "✅",
      };

    case "host_edit":
      return {
        message: "Host updated the bill. Check your items.",
        emoji: "✏️",
      };

    case "session_close":
      return {
        message: "Session complete! Here's the final breakdown.",
        emoji: "🎉",
      };

    case "participant_left":
      return {
        message: `${input.actor_name} disconnected.`,
        emoji: "📡",
      };

    case "participant_reconnected":
      return {
        message: `${input.actor_name} is back.`,
        emoji: "📡",
      };

    // ─── Phase 3: Dispute Templates ───────────────────────────
    case "dispute_raised":
      return {
        message: `${input.actor_name} has a question about their total.`,
        emoji: "⚠️",
      };

    case "dispute_resolved":
      return {
        message: `${input.actor_name}'s total has been updated.`,
        emoji: "✅",
      };

    case "dispute_rejected":
      return {
        message: `${input.actor_name}'s total was confirmed by the host.`,
        emoji: "✅",
      };

    // ─── Phase 3: Settlement Templates ────────────────────────
    case "settled":
      return {
        message: `${input.actor_name} has paid up!`,
        emoji: "💰",
      };

    case "all_settled":
      return {
        message: "Session complete! Everyone has paid.",
        emoji: "🎉",
      };

    // ─── Phase 3: Checkout Progress Templates ─────────────────
    case "progress_50": {
      const checked = input.claimant_count ?? 0;
      const totalParticipants = input.amount ?? 0;
      return {
        message: `Halfway there — ${checked}/${totalParticipants > 0 ? totalParticipants : "?"} have checked out.`,
        emoji: "⏳",
      };
    }

    case "progress_almost": {
      const remaining = input.claimant_count ?? 1;
      return {
        message: `Almost done — waiting on ${remaining} more ${remaining === 1 ? "person" : "people"}.`,
        emoji: "👀",
      };
    }

    case "progress_complete":
      return {
        message: "Everyone has checked out!",
        emoji: "🎉",
      };

    // ─── Phase 3: Reallocation Templates ──────────────────────
    case "item_reassigned":
      return {
        message: `Host assigned ${input.item_name ?? "an item"} to ${input.actor_name}.`,
        emoji: "🔄",
      };

    case "item_split":
      return {
        message: `Host split ${input.item_name ?? "an item"} equally among everyone.`,
        emoji: "🔄",
      };

    case "item_absorbed":
      return {
        message: `Host covered the ${input.item_name ?? "an item"}.`,
        emoji: "🙌",
      };

    default:
      return {
        message: `${input.actor_name} did something.`,
        emoji: "❓",
      };
  }
}

// ─── Batching / Debounce (5-second buffer for claims) ────────────────

async function tryBatchClaim(
  sessionId: string,
  actorName: string,
  participantId: string,
  itemName: string
): Promise<{ batched: boolean; batchedMessage?: string; batchedEmoji?: string }> {
  const bufferKey = RedisKeys.feedBuffer(sessionId, participantId);

  const entry: BufferedClaim = { item_name: itemName, timestamp: Date.now() };

  // Push to buffer list
  await redis.rpush(bufferKey, JSON.stringify(entry));
  await redis.expire(bufferKey, 5);

  // Check buffer length
  const bufferLength = await redis.llen(bufferKey);

  if (bufferLength <= 1) {
    // First claim in this window — schedule a flush after 5s
    // We'll handle this by NOT emitting immediately for claims.
    // Instead, we wait 5s then flush. But we need a mechanism.
    // Since Redis doesn't have delayed execution, we use a simple approach:
    // On first entry, set a flag and schedule a setTimeout on the server.
    // For simplicity and reliability, use a server-side debounce map.
    scheduleBatchFlush(sessionId, participantId, actorName);
    return { batched: true };
  }

  // Additional claims in the window — they'll be picked up by the scheduled flush
  return { batched: true };
}

/** In-memory debounce timers for claim batching */
const batchTimers = new Map<string, NodeJS.Timeout>();

function scheduleBatchFlush(
  sessionId: string,
  participantId: string,
  actorName: string
): void {
  const timerKey = `${sessionId}:${participantId}`;

  // If there's already a timer, clear and reschedule
  const existing = batchTimers.get(timerKey);
  if (existing) {
    clearTimeout(existing);
  }

  const timer = setTimeout(async () => {
    batchTimers.delete(timerKey);
    await flushBatchBuffer(sessionId, participantId, actorName);
  }, 5000);

  batchTimers.set(timerKey, timer);
}

async function flushBatchBuffer(
  sessionId: string,
  participantId: string,
  actorName: string
): Promise<void> {
  const bufferKey = RedisKeys.feedBuffer(sessionId, participantId);

  // Get all buffered items
  const entries = await redis.lrange(bufferKey, 0, -1);
  await redis.del(bufferKey);

  if (entries.length === 0) return;

  const claims: BufferedClaim[] = entries.map((e) => JSON.parse(e));
  const itemNames = claims.map((c) => c.item_name);

  let message: string;
  let emoji: string;

  if (itemNames.length === 1) {
    // Single item — use normal template
    const built = await buildFeedMessage(sessionId, {
      type: "claim",
      actor_name: actorName,
      item_name: itemNames[0],
      amount: undefined,
      claimant_count: 1,
    });
    message = built.message;
    emoji = built.emoji;
  } else {
    // Multiple items — batched message
    const last = itemNames[itemNames.length - 1];
    const rest = itemNames.slice(0, -1);
    const itemList = `${rest.join(", ")}, and ${last}`;
    message = `${actorName} claimed ${itemList}.`;
    emoji = "🍽️";
  }

  const feedEvent: FeedEventPayload = {
    type: "claim",
    actor_name: actorName,
    message,
    emoji,
    metadata: { items: itemNames },
    timestamp: Date.now(),
  };

  // Store in Redis Stream
  const streamKey = RedisKeys.feedStream(sessionId);
  await redis.xadd(
    streamKey,
    "*",
    "data",
    JSON.stringify(feedEvent)
  );
  await redis.expire(streamKey, SESSION_CACHE_TTL);

  // Broadcast to room
  try {
    const io = getIO();
    io.to(`session:${sessionId}`).emit("feed:event", feedEvent);
  } catch {
    // IO not ready yet, skip broadcast
  }
}

// ─── Push Feed Event (main entry point) ──────────────────────────────

export async function pushFeedEvent(
  sessionId: string,
  input: FeedEventInput
): Promise<void> {
  // For claim events, use the batching system
  if (input.type === "claim" && input.item_name) {
    // We need participant_id for batching — look it up from actor_name
    const stateKey = RedisKeys.sessionState(sessionId);
    const cached = await redis.get(stateKey);
    let participantId = "unknown";
    if (cached) {
      const state = JSON.parse(cached);
      const participant = state.participants?.find(
        (p: { displayName: string }) => p.displayName === input.actor_name
      );
      if (participant) {
        participantId = participant.participantId;
      }
    }

    const result = await tryBatchClaim(
      sessionId,
      input.actor_name,
      participantId,
      input.item_name
    );

    if (result.batched) {
      // Will be flushed by the timer — don't emit now
      return;
    }
  }

  // Non-claim events: emit immediately
  const { message, emoji } = await buildFeedMessage(sessionId, input);

  const feedEvent: FeedEventPayload = {
    type: input.type,
    actor_name: input.actor_name,
    message,
    emoji,
    metadata: {
      ...(input.item_name ? { item_name: input.item_name } : {}),
      ...(input.amount !== undefined ? { amount: input.amount } : {}),
      ...(input.claimant_count !== undefined
        ? { claimant_count: input.claimant_count }
        : {}),
    },
    timestamp: Date.now(),
  };

  // Store in Redis Stream
  const streamKey = RedisKeys.feedStream(sessionId);
  await redis.xadd(streamKey, "*", "data", JSON.stringify(feedEvent));
  await redis.expire(streamKey, SESSION_CACHE_TTL);

  // Broadcast to room
  try {
    const io = getIO();
    io.to(`session:${sessionId}`).emit("feed:event", feedEvent);
  } catch {
    // IO not ready yet, skip broadcast
  }
}

// ─── Read Feed History ───────────────────────────────────────────────

export async function getFeedHistory(
  sessionId: string,
  count: number = 50
): Promise<FeedEventPayload[]> {
  const streamKey = RedisKeys.feedStream(sessionId);

  // Read the last N entries from the stream
  const entries = await redis.xrevrange(streamKey, "+", "-", "COUNT", count);

  return entries
    .map(([, fields]) => {
      const dataStr = fields[1]; // fields = ['data', '{"type":...}']
      try {
        return JSON.parse(dataStr) as FeedEventPayload;
      } catch {
        return null;
      }
    })
    .filter((e): e is FeedEventPayload => e !== null)
    .reverse(); // Oldest first
}
