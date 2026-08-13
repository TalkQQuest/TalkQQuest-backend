import { Prisma } from "@prisma/client";
import { prisma } from "../../../config/database";

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

// #145 — 성장 리포트 누적 점수용. 유저 전체 기간에 걸쳐 4개 지표를 합산한다.
// 컬럼에 누적치를 따로 들고 있지 않고 매번 SUM으로 집계한다 — 스키마 변경이 없고
// 기존 피드백 데이터가 자동으로 소급 반영된다.
export const sumFeedbackMetricTotals = async (userId: string) => {
  const result = await prisma.feedbacks.aggregate({
    where: { user_id: userId, status: "ready" },
    _sum: {
      kindness_score: true,
      initiative_score: true,
      empathy_score: true,
      question_link_score: true,
    },
  });
  return {
    kindnessTotal: result._sum.kindness_score ?? 0,
    initiativeTotal: result._sum.initiative_score ?? 0,
    empathyTotal: result._sum.empathy_score ?? 0,
    questionLinkTotal: result._sum.question_link_score ?? 0,
  };
};

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

// ----- Conversations (목록 표시용 대표 미션 제목) -----
// selected_topic은 대화 시작 시 사용자가 입력하는 자유 입력 필드로 미션과 무관하다(#107).
// 대표 제목은 반드시 실제 미션 제목(Missions.title) 기준으로 뽑아야 한다.

export const findConversationMissionTitlesInRange = (userId: string, start: Date, end: Date) =>
  prisma.conversations.findMany({
    where: { user_id: userId, started_at: { gte: start, lt: end } },
    select: { mission: { select: { title: true } } },
  });

// ----- Conversations (성장 리포트 저장 시 소유권 확인용) -----

export const findConversationByIdAndUserId = (conversationId: string, userId: string) =>
  prisma.conversations.findFirst({
    where: { id: conversationId, user_id: userId },
    select: { id: true, mission: { select: { title: true } } },
  });

// ----- Reports -----

// #145 — 대화 하나당 리포트 1건(conversation_id unique). 같은 대화로 재요청하면 P2002가 나므로
// 서비스 계층에서 잡아 기존 저장 결과를 그대로 반환한다(멱등 처리).
export const createReport = (userId: string, conversationId: string, period: string, data: unknown) =>
  prisma.reports.create({
    data: { user_id: userId, conversation_id: conversationId, period, data: data as object },
  });

export const findReportByConversationId = (conversationId: string) =>
  prisma.reports.findUnique({ where: { conversation_id: conversationId } });

export const findReportsByUserId = (userId: string) =>
  prisma.reports.findMany({
    where: { user_id: userId },
    orderBy: { created_at: "desc" },
  });

export const findReportByIdAndUserId = (reportId: string, userId: string) =>
  prisma.reports.findFirst({ where: { id: reportId, user_id: userId } });

export const deleteReport = (reportId: string, tx?: Prisma.TransactionClient) =>
  (tx ?? prisma).reports.delete({ where: { id: reportId } });

// ----- Weekly_Compare_Reports (#145) -----
// 가입일 기준 완결 주차마다 자동 생성되는 스냅샷. (user_id, week_index) unique로 중복 생성을 막는다.

export const createWeeklyCompareReport = (userId: string, weekIndex: number, data: unknown) =>
  prisma.weekly_Compare_Reports.create({
    data: { user_id: userId, week_index: weekIndex, data: data as object },
  });

// 이 유저에게 마지막으로 생성된 리포트(비교 대상 = 가장 최근 리포트). 없으면 null(첫 리포트).
export const findLatestWeeklyCompareReport = (userId: string) =>
  prisma.weekly_Compare_Reports.findFirst({
    where: { user_id: userId },
    orderBy: { week_index: "desc" },
  });

// 특정 주차의 리포트. P2002 경합에서 진 뒤 승자가 실제로 뭘 저장했는지 다시 읽을 때 쓴다.
export const findWeeklyCompareReportByWeekIndex = (userId: string, weekIndex: number) =>
  prisma.weekly_Compare_Reports.findUnique({
    where: { user_id_week_index: { user_id: userId, week_index: weekIndex } },
  });

export const findWeeklyCompareReportsByUserId = (userId: string) =>
  prisma.weekly_Compare_Reports.findMany({
    where: { user_id: userId },
    orderBy: { week_index: "desc" },
  });

export const findWeeklyCompareReportByIdAndUserId = (id: string, userId: string) =>
  prisma.weekly_Compare_Reports.findFirst({ where: { id, user_id: userId } });

// #195 — data.lastWeek이 실제로 몇 번째 주(week_index)였는지 찾는다. 생성 로직이 항상
// "그 시점에 가장 최근에 있던 리포트"와 비교하며 순서대로(건너뛰지 않고) 생성되므로,
// weekIndex보다 작은 week_index 중 가장 큰 것이 곧 비교 대상 주다. 없으면(가입 후 첫
// 리포트) null — 비교 대상 자체가 없다는 뜻이다.
export const findPreviousWeeklyCompareWeekIndex = async (
  userId: string,
  weekIndex: number
): Promise<number | null> => {
  const row = await prisma.weekly_Compare_Reports.findFirst({
    where: { user_id: userId, week_index: { lt: weekIndex } },
    orderBy: { week_index: "desc" },
    select: { week_index: true },
  });
  return row?.week_index ?? null;
};

export const deleteWeeklyCompareReport = (id: string, tx?: Prisma.TransactionClient) =>
  (tx ?? prisma).weekly_Compare_Reports.delete({ where: { id } });
