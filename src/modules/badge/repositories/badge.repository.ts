import { prisma } from "../../../config/database";

export const findUserBadgesByUserId = (userId: string) =>
  prisma.user_Badges.findMany({
    where: { user_id: userId },
    include: { badge: true },
    orderBy: { earned_at: "desc" },
  });
