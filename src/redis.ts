import Redis from "ioredis";

let redisClient: Redis | null = null;

function getRedisUrl(): string | undefined {
  return process.env.REDIS_URL;
}

export function getRedis(): Redis | null {
  if (redisClient) return redisClient;

  const url = getRedisUrl();
  if (!url) return null;

  redisClient = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 5) return null;
      return Math.min(times * 200, 2000);
    },
  });

  redisClient.on("error", (err) => {
    console.error("[redis] connection error:", err.message);
  });

  return redisClient;
}

export async function connectRedis(): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  try {
    await redis.connect();
    console.log("[redis] connected");
    return true;
  } catch (err) {
    console.error("[redis] failed to connect:", err instanceof Error ? err.message : err);
    return false;
  }
}

export async function disconnectRedis(): Promise<void> {
  if (!redisClient) return;
  try {
    await redisClient.quit();
  } catch {
    // ignore
  }
  redisClient = null;
}

export interface CachedPrice {
  price: number;
  previousPrice: number;
  timestamp: number;
}

const fallbackPriceCache = new Map<string, CachedPrice>();

export async function getCachedPrice(symbol: string): Promise<CachedPrice | null> {
  const redis = getRedis();
  if (!redis) return fallbackPriceCache.get(symbol) ?? null;

  try {
    const raw = await redis.get(`price:${symbol}`);
    if (!raw) return null;
    return JSON.parse(raw) as CachedPrice;
  } catch (err) {
    console.error(`[redis] getCachedPrice error for ${symbol}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

export async function setCachedPrice(symbol: string, data: CachedPrice): Promise<void> {
  fallbackPriceCache.set(symbol, data);

  const redis = getRedis();
  if (!redis) return;

  try {
    await redis.set(`price:${symbol}`, JSON.stringify(data), "EX", 65);
  } catch (err) {
    console.error(`[redis] setCachedPrice error for ${symbol}:`, err instanceof Error ? err.message : err);
  }
}

const fallbackCooldowns = new Map<string, number>();

export async function getCooldown(key: string): Promise<number | null> {
  const redis = getRedis();
  if (!redis) return fallbackCooldowns.get(key) ?? null;

  try {
    const raw = await redis.get(`cooldown:${key}`);
    if (!raw) return null;
    return parseInt(raw, 10);
  } catch (err) {
    console.error(`[redis] getCooldown error:`, err instanceof Error ? err.message : err);
    return null;
  }
}

export async function setCooldown(key: string, timestamp: number, ttlMs: number): Promise<void> {
  fallbackCooldowns.set(key, timestamp);

  const redis = getRedis();
  if (!redis) return;

  try {
    const ttlSec = Math.ceil(ttlMs / 1000);
    await redis.set(`cooldown:${key}`, timestamp.toString(), "EX", ttlSec);
  } catch (err) {
    console.error(`[redis] setCooldown error:`, err instanceof Error ? err.message : err);
  }
}

export async function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): Promise<{ allowed: boolean; remaining: number }> {
  const redis = getRedis();
  if (!redis) return { allowed: true, remaining: maxRequests };

  try {
    const now = Date.now();
    const windowStart = now - windowMs;
    const rk = `ratelimit:${key}`;

    await redis.zremrangebyscore(rk, 0, windowStart);
    const count = await redis.zcard(rk);

    if (count >= maxRequests) {
      return { allowed: false, remaining: 0 };
    }

    await redis.zadd(rk, now, `${now}-${Math.random().toString(36).slice(2)}`);
    await redis.expire(rk, Math.ceil(windowMs / 1000) + 1);

    return { allowed: true, remaining: maxRequests - count - 1 };
  } catch (err) {
    console.error(`[redis] checkRateLimit error:`, err instanceof Error ? err.message : err);
    return { allowed: true, remaining: maxRequests };
  }
}

export async function acquireJobLock(
  jobName: string,
  ttlMs: number,
): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return true;

  try {
    const result = await redis.set(
      `joblock:${jobName}`,
      Date.now().toString(),
      "PX",
      ttlMs,
      "NX",
    );
    return result === "OK";
  } catch (err) {
    console.error(`[redis] acquireJobLock error:`, err instanceof Error ? err.message : err);
    return true;
  }
}

export async function releaseJobLock(jobName: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  try {
    await redis.del(`joblock:${jobName}`);
  } catch (err) {
    console.error(`[redis] releaseJobLock error:`, err instanceof Error ? err.message : err);
  }
}

export async function enqueueJob(queue: string, payload: unknown): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  try {
    await redis.rpush(`queue:${queue}`, JSON.stringify(payload));
  } catch (err) {
    console.error(`[redis] enqueueJob error:`, err instanceof Error ? err.message : err);
  }
}

export async function dequeueJob(queue: string): Promise<unknown | null> {
  const redis = getRedis();
  if (!redis) return null;

  try {
    const raw = await redis.lpop(`queue:${queue}`);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[redis] dequeueJob error:`, err instanceof Error ? err.message : err);
    return null;
  }
}
