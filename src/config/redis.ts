import Redis from "ioredis";
import { env } from "./env";
import { logger } from "./logger";

// 세션/캐시 용도로 사용하는 Redis 클라이언트입니다.
// lazyConnect: 모듈 import 시점이 아니라 첫 명령 실행 시점에 연결한다.
// (health.test.ts처럼 redis를 안 쓰는 테스트에서도 import 체인 때문에 연결이 열려
//  Jest가 종료되지 않는 문제가 있었다.)
export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
});

redis.on("error", (err) => {
  logger.error({ err }, "[redis] connection error");
});
