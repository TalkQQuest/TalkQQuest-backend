// modules/xp/repositories/xp.repository.ts
import { prisma } from "../../../config/database";

// 레벨/현재 진행도는 User_Profiles에, 지급 내역은 XP_History에 나뉘어 있다.
// User_Profiles.xp는 누적 총합이 아니라 "현재 레벨 내 진행도"(레벨업 시 차감됨)이므로,
// 누적 경험치는 XP_History를 합산해야 한다.

export const findProfileXpByUserId = (userId: string) =>
  prisma.user_Profiles.findUnique({
    where: { user_id: userId },
    select: { level: true, xp: true },
  });

// 누적 경험치 (requirements.md Requirement 9.1의 "누적 경험치").
// 차감(음수 amount)도 그대로 합산되므로 원장 기준 순증분이 된다.
export const sumXpAmountByUserId = (userId: string) =>
  prisma.xP_History.aggregate({
    where: { user_id: userId },
    _sum: { amount: true },
  });

export const findXpHistoryByUserId = (userId: string, page: number, size: number) =>
  prisma.xP_History.findMany({
    where: { user_id: userId },
    orderBy: { created_at: "desc" },
    skip: (page - 1) * size,
    take: size,
  });

export const countXpHistoryByUserId = (userId: string) =>
  prisma.xP_History.count({ where: { user_id: userId } });
