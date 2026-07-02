import pino from "pino";
import { env } from "./env";

// 앱 전역에서 사용하는 단일 로거 인스턴스입니다.
// console.log/console.error를 직접 호출하지 말고 이 logger를 사용합니다.
export const logger = pino({
  level: env.NODE_ENV === "production" ? "info" : "debug",
  transport:
    env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" } }
      : undefined,
});
