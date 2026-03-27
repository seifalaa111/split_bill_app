import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

function createRedisClient(label: string): Redis {
  const client = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 3,
    retryStrategy(times: number) {
      const delay = Math.min(times * 200, 5000);
      console.log(`[Redis:${label}] Reconnecting in ${delay}ms (attempt ${times})`);
      return delay;
    },
    lazyConnect: false,
  });

  client.on("connect", () => {
    console.log(`[Redis:${label}] Connected`);
  });

  client.on("error", (err: Error) => {
    console.error(`[Redis:${label}] Error:`, err.message);
  });

  client.on("close", () => {
    console.log(`[Redis:${label}] Connection closed`);
  });

  return client;
}

/** Main Redis client for reads/writes */
export const redis = createRedisClient("main");

/** Dedicated pub client for Socket.IO adapter */
export const redisPub = createRedisClient("pub");

/** Dedicated sub client for Socket.IO adapter */
export const redisSub = createRedisClient("sub");

/** Session state cache TTL in seconds (4 hours) */
export const SESSION_CACHE_TTL = 4 * 60 * 60;

/** Redis key helpers */
export const RedisKeys = {
  sessionState: (sessionId: string) => `session:${sessionId}:state`,
  feedStream: (sessionId: string) => `feed:${sessionId}`,
  feedBuffer: (sessionId: string, participantId: string) =>
    `feed:buffer:${sessionId}:${participantId}`,
  premiumThreshold: (sessionId: string) =>
    `session:${sessionId}:premium_threshold`,
  autoClose: (sessionId: string) => `session:${sessionId}:auto_close`,
  participantStatusSince: (participantId: string) =>
    `participant:${participantId}:status_since`,
} as const;
