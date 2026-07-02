import Redis from "ioredis";
import { env } from "./env";
import { logger } from "./logger";

// 세션/캐시 용도로 사용하는 Redis 클라이언트입니다.
export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
});

redis.on("error", (err) => {
  logger.error({ err }, "[redis] connection error");
});
