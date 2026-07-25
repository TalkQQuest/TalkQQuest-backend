import { Prisma } from "@prisma/client";
import { prisma } from "../../../config/database";

type TxClient = Prisma.TransactionClient;

export const findUserBadgesByUserId = (userId: string) =>
  prisma.user_Badges.findMany({
    where: { user_id: userId },
    include: { badge: true },
    orderBy: { earned_at: "desc" },
  });

export const findAllBadges = (db: typeof prisma | TxClient = prisma) => db.badges.findMany();

export const findEarnedBadgeIds = async (
  db: typeof prisma | TxClient,
  userId: string
): Promise<Set<string>> => {
  const rows = await db.user_Badges.findMany({
    where: { user_id: userId },
    select: { badge_id: true },
  });
  return new Set(rows.map((r) => r.badge_id));
};

// User_Badges.[user_id, badge_id]에 unique 제약이 있어, 동시성 상황에서도 중복 insert가 안전하게 막힌다.
export const createUserBadge = (db: typeof prisma | TxClient, userId: string, badgeId: string) =>
  db.user_Badges.create({
    data: { user_id: userId, badge_id: badgeId, earned_at: new Date() },
  });
