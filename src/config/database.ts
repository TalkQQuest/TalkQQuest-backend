import { PrismaClient } from "@prisma/client";
import { env } from "./env";

// Repository 계층에서만 이 client를 import합니다 (CONVENTION.md `## 2. 레이어 원칙` 참고).
export const prisma = new PrismaClient({
  log: env.NODE_ENV === "development" ? ["query", "warn", "error"] : ["warn", "error"],
});
