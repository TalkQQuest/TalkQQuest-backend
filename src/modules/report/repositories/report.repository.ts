// modules/report/repositories/report.repository.ts
import { prisma } from "../../../config/database";

// GET /reports/weekly-compare — 주어진 기간[from, to)에 완료된 미션 수.
export const countCompletedMissionsInRange = (userId: string, from: Date, to: Date) =>
  prisma.mission_Records.count({
    where: { user_id: userId, status: "completed", completed_at: { gte: from, lt: to } },
  });

// 주어진 기간[from, to)에 획득한 XP 합계. XP_History가 원장이므로 이걸 합산한다
// (음수=차감도 그대로 반영되어 그 주의 순증분을 나타낸다).
export const sumXpEarnedInRange = (userId: string, from: Date, to: Date) =>
  prisma.xP_History.aggregate({
    where: { user_id: userId, created_at: { gte: from, lt: to } },
    _sum: { amount: true },
  });
