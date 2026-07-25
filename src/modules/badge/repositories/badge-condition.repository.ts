import { Prisma } from "@prisma/client";
import { prisma } from "../../../config/database";

type TxClient = Prisma.TransactionClient;
type Db = typeof prisma | TxClient;

export const countCompletedMissions = (db: Db, userId: string) =>
  db.mission_Records.count({ where: { user_id: userId, status: "completed" } });

export const countCompletedMissionsByCategories = (db: Db, userId: string, categories: string[]) =>
  db.mission_Records.count({
    where: { user_id: userId, status: "completed", mission: { category: { in: categories } } },
  });

export const countDistinctCompletedCategories = async (db: Db, userId: string): Promise<number> => {
  const rows = await db.mission_Records.findMany({
    where: { user_id: userId, status: "completed" },
    select: { mission: { select: { category: true } } },
    distinct: ["mission_id"],
  });
  return new Set(rows.map((r) => r.mission.category)).size;
};

// 스트릭 판정용: 완료일(day 단위, 로컬 자정 기준) 목록을 최신순 중복 제거해서 가져온다.
export const findCompletedMissionDates = async (db: Db, userId: string): Promise<Date[]> => {
  const rows = await db.mission_Records.findMany({
    where: { user_id: userId, status: "completed", completed_at: { not: null } },
    select: { completed_at: true },
    orderBy: { completed_at: "desc" },
  });
  const days = new Set(
    rows.map((r) => {
      const d = r.completed_at!;
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    })
  );
  return [...days].sort((a, b) => b - a).map((t) => new Date(t));
};

export const countFeedbacksByMetricThreshold = (
  db: Db,
  userId: string,
  metric: "kindness" | "initiative" | "empathy" | "questionLink",
  threshold: number
) => {
  const columnMap = {
    kindness: "kindness_score",
    initiative: "initiative_score",
    empathy: "empathy_score",
    questionLink: "question_link_score",
  } as const;

  return db.feedbacks.count({
    where: { user_id: userId, status: "ready", [columnMap[metric]]: { gte: threshold } },
  });
};

export const countFeedbacksAllMetricsThreshold = (db: Db, userId: string, threshold: number) =>
  db.feedbacks.count({
    where: {
      user_id: userId,
      status: "ready",
      kindness_score: { gte: threshold },
      initiative_score: { gte: threshold },
      empathy_score: { gte: threshold },
      question_link_score: { gte: threshold },
    },
  });

export const countCreatedFeedbacks = (db: Db, userId: string) =>
  db.feedbacks.count({ where: { user_id: userId } });
