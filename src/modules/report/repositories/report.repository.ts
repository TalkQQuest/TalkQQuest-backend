import { prisma } from "../../../config/database";
import { ReportType } from "../dtos/report.dto";

// ----- User level/xp -----

export const findProfileByUserId = (userId: string) =>
  prisma.user_Profiles.findUnique({
    where: { user_id: userId },
    select: { level: true, xp: true },
  });

// 레벨 역산(과거 시점의 레벨 재구성)을 위해 XP_History 전체를 오래된 순으로 가져온다.
export const findXpHistoryAscByUserId = (userId: string) =>
  prisma.xP_History.findMany({
    where: { user_id: userId },
    orderBy: { created_at: "asc" },
    select: { amount: true, created_at: true },
  });

export const sumXpAmountInRange = async (userId: string, start: Date, end: Date) => {
  const result = await prisma.xP_History.aggregate({
    where: { user_id: userId, created_at: { gte: start, lt: end } },
    _sum: { amount: true },
  });
  return result._sum.amount ?? 0;
};

// ----- Feedbacks -----

export const findFeedbackScoresInRange = (userId: string, start: Date, end: Date) =>
  prisma.feedbacks.findMany({
    where: {
      user_id: userId,
      status: "ready",
      created_at: { gte: start, lt: end },
    },
    select: {
      kindness_score: true,
      initiative_score: true,
      empathy_score: true,
      question_link_score: true,
      created_at: true,
    },
  });

// ----- Mission_Records / Missions -----

export const findCompletedMissionCategoriesInRange = (userId: string, start: Date, end: Date) =>
  prisma.mission_Records.findMany({
    where: {
      user_id: userId,
      status: "completed",
      completed_at: { gte: start, lt: end },
    },
    select: { mission: { select: { category: true } } },
  });

export const countCompletedMissionRecordsInRange = (userId: string, start: Date, end: Date) =>
  prisma.mission_Records.count({
    where: { user_id: userId, status: "completed", completed_at: { gte: start, lt: end } },
  });

export const countTotalMissions = () => prisma.missions.count({ where: { is_template: false } });

export const countDistinctCompletedMissions = async (userId: string) => {
  const rows = await prisma.mission_Records.findMany({
    where: { user_id: userId, status: "completed", mission: { is_template: false } },
    select: { mission_id: true },
    distinct: ["mission_id"],
  });
  return rows.length;
};

// ----- Conversations (목록 표시용 대표 주제) -----

export const findConversationTopicsInRange = (userId: string, start: Date, end: Date) =>
  prisma.conversations.findMany({
    where: { user_id: userId, started_at: { gte: start, lt: end }, selected_topic: { not: null } },
    select: { selected_topic: true },
  });

// ----- Reports -----

export const createReport = (userId: string, type: ReportType, period: string, data: unknown) =>
  prisma.reports.create({
    data: { user_id: userId, type, period, data: data as object },
  });

export const findReportsByUserId = (userId: string, type?: ReportType) =>
  prisma.reports.findMany({
    where: { user_id: userId, ...(type && { type }) },
    orderBy: { created_at: "desc" },
  });

export const findReportByIdAndUserId = (reportId: string, userId: string) =>
  prisma.reports.findFirst({ where: { id: reportId, user_id: userId } });
