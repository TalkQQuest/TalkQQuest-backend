import { Prisma } from "@prisma/client";
import { prisma } from "../../../config/database";
import { logger } from "../../../config/logger";
import { ReportConversationNotFoundError, ReportNotFoundError, WeeklyCompareReportNotFoundError } from "../errors/report.error";
import * as reportRepository from "../repositories/report.repository";
import {
  createArchiveItem,
  deleteArchiveItem,
  findArchiveItemByReference,
  findArchivedReferenceIds,
} from "../../archive/repositories/archive.repository";
import { getGrowthReport, getGrowthWindowStart } from "./growth.service";
import {
  DeleteReportResponseDto,
  DeleteWeeklyCompareReportResponseDto,
  GrowthReportDto,
  ListReportsResponseDto,
  ListWeeklyCompareReportsResponseDto,
  ReportDetailResponseDto,
  SaveReportResponseDto,
  SaveWeeklyCompareReportResponseDto,
  WeeklyCompareReportDetailResponseDto,
  WeeklyCompareReportDto,
  TopCategoryDto,
} from "../dtos/report.dto";
import { findNotificationSettings } from "../../notification/repositories/notification.repository";
import { notifyUser } from "../../notification/services/notification.service";
import * as missionRepository from "../../mission/repositories/mission.repository";


// 성장 리포트 스냅샷 Json 컬럼 구조 (#145 — weeklyCompare는 더 이상 여기 포함되지 않는다).
interface StoredReportData {
  title: string;
  growth: GrowthReportDto;
}

const toDateOnly = (date: Date): string => date.toISOString().slice(0, 10);

const notifyReportReady = async (
  userId: string,
  title: string,
  body: string,
  referenceId: string,
  referenceType: string
): Promise<void> => {
  const settings = await findNotificationSettings(userId);
  if (!settings?.report_ready) return;
  await notifyUser(userId, "report_ready", title, body, referenceId, referenceType);
};

// Archive_Items에는 (user_id, item_type, reference_id) unique 제약이 있다. 이미 있으면
// 그대로 두고, 없으면 새로 만든다 — 동시 요청이나 이전 실패로 인한 중복 생성을 방지한다.
const ensureArchived = async (userId: string, itemType: "report" | "weekly_compare", referenceId: string) => {
  const existing = await findArchiveItemByReference(userId, itemType, referenceId);
  if (existing) return existing;

  try {
    return await createArchiveItem({ user: { connect: { id: userId } }, item_type: itemType, reference_id: referenceId });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const winner = await findArchiveItemByReference(userId, itemType, referenceId);
      if (winner) return winner;
    }
    throw error;
  }
};

// Reports 행은 있는데 Archive_Items 생성이 이전 요청에서 실패해 누락됐을 수 있다
// (서로 다른 트랜잭션이라 부분 실패 가능) — 재요청 시점에 복구한다.
const ensureReportArchived = async (userId: string, reportId: string): Promise<void> => {
  await ensureArchived(userId, "report", reportId);
};

// #145 — 성장 리포트는 대화 하나를 기준으로 저장된다. 같은 대화로 재요청하면 이미 저장된
// 결과를 그대로 돌려준다(멱등) — 새로 계산하거나 에러를 던지지 않는다.
export const saveReport = async (
  userId: string,
  conversationId: string
): Promise<SaveReportResponseDto> => {
  const conversation = await reportRepository.findConversationByIdAndUserId(conversationId, userId);
  if (!conversation) throw new ReportConversationNotFoundError();

  const existing = await reportRepository.findReportByConversationId(conversationId);
  if (existing) {
    await ensureReportArchived(userId, existing.id);
    return {
      reportId: existing.id,
      period: existing.period,
      createdAt: existing.created_at.toISOString(),
    };
  }

  const now = new Date();
  const growthWindowStart = getGrowthWindowStart(now);
  const growth = await getGrowthReport(userId);
  const period = `${toDateOnly(growthWindowStart)}~${toDateOnly(now)}`;
  const title = conversation.mission.title;
  const stored: StoredReportData = { title, growth };

  let created;
  try {
    created = await reportRepository.createReport(userId, conversationId, period, stored);
  } catch (error) {
    // P2002 = conversation_id unique 위반. 동시에 같은 대화로 두 번 저장 요청이 들어온 경우,
    // 먼저 만들어진 쪽을 그대로 돌려준다(멱등).
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const winner = await reportRepository.findReportByConversationId(conversationId);
      if (winner) {
        await ensureReportArchived(userId, winner.id);
        return { reportId: winner.id, period: winner.period, createdAt: winner.created_at.toISOString() };
      }
    }
    throw error;
  }

  await ensureReportArchived(userId, created.id);
  await notifyReportReady(
    userId,
    "성장 리포트가 도착했어요!",
    "새로 저장한 성장 리포트를 확인해보세요.",
    created.id,
    "report"
  );

  return { reportId: created.id, period, createdAt: created.created_at.toISOString() };
};

export const listReports = async (userId: string): Promise<ListReportsResponseDto> => {
  const rows = await reportRepository.findReportsByUserId(userId);
  return {
    reports: rows.map((row) => {
      const data = row.data as unknown as StoredReportData;
      return {
        id: row.id,
        period: row.period,
        title: data?.title ?? "톡깨 리포트",
        createdAt: row.created_at.toISOString(),
      };
    }),
  };
};

export const getReportDetail = async (
  userId: string,
  reportId: string
): Promise<ReportDetailResponseDto> => {
  const row = await reportRepository.findReportByIdAndUserId(reportId, userId);
  if (!row) throw new ReportNotFoundError();

  const data = row.data as unknown as StoredReportData;

  return {
    id: row.id,
    period: row.period,
    title: data?.title ?? "톡깨 리포트",
    growth: data.growth,
    createdAt: row.created_at.toISOString(),
  };
};

// 저장(POST /reports)이 Reports + Archive_Items를 함께 만드는 것과 대칭으로, 해제도 둘 다 지운다.
// 삭제하면 unique(conversation_id) 제약이 풀리므로 같은 대화로 다시 저장할 수 있다.
export const deleteReport = async (
  userId: string,
  reportId: string
): Promise<DeleteReportResponseDto> => {
  const report = await reportRepository.findReportByIdAndUserId(reportId, userId);
  if (!report) throw new ReportNotFoundError();

  const archiveItem = await findArchiveItemByReference(userId, "report", reportId);

  await prisma.$transaction(async (tx) => {
    if (archiveItem) {
      await deleteArchiveItem(archiveItem.id, tx);
    }
    await reportRepository.deleteReport(reportId, tx);
  });

  return { reportId, deleted: true };
};

// ── 주간 비교 리포트 (#145) ──
// 생성은 weekly-compare.service.ts가 대화 완료 시점에 자동으로 한다. 여기서는 조회/저장/삭제만
// 다룬다 — 목록/상세는 자동 생성된 것을 그대로 보여주고, Archive에 남기려면 별도로 저장해야 한다.

export const listWeeklyCompareReports = async (userId: string): Promise<ListWeeklyCompareReportsResponseDto> => {
  const [rows, savedIds] = await Promise.all([
    reportRepository.findWeeklyCompareReportsByUserId(userId),
    findArchivedReferenceIds(userId, "weekly_compare"),
  ]);

  return {
    reports: rows.map((row) => {
      const data = row.data as unknown as WeeklyCompareReportDto;
      return {
        id: row.id,
        weekIndex: row.week_index,
        overallScoreChange: data.overallScoreChange,
        isSaved: savedIds.has(row.id),
        createdAt: row.created_at.toISOString(),
      };
    }),
  };
};

export const getWeeklyCompareReportDetail = async (
  userId: string,
  id: string
): Promise<WeeklyCompareReportDetailResponseDto> => {
  const row = await reportRepository.findWeeklyCompareReportByIdAndUserId(id, userId);
  if (!row) throw new WeeklyCompareReportNotFoundError();

  // topCategories/missionProgress는 스냅샷에 저장하지 않고 조회 시점에 라이브 계산한다(#201).
  // 전체 미션 수/완료 미션 수는 계속 변하므로, 생성 시점 값을 고정 저장하면 나중에 조회할 때
  // 낡은 값이 나온다. growth.service.ts와 같은 기준(최근 4주, GET /missions와 동일한
  // 공개 범위)으로 계산해 growth와 일관성을 맞춘다.
  const personalityType = await missionRepository.findUserPersonalityType(userId);
  const visibility = { userId, personalityType };
  const windowStart = getGrowthWindowStart(new Date());

  const [archiveItem, previous, next, missionCategories, totalMissions, completedMissions] = await Promise.all([
    findArchiveItemByReference(userId, "weekly_compare", id),
    reportRepository.findWeeklyCompareReportByWeekIndex(userId, row.week_index - 1),
    reportRepository.findWeeklyCompareReportByWeekIndex(userId, row.week_index + 1),
    reportRepository.findCompletedMissionCategoriesInRange(userId, windowStart, new Date()),
    reportRepository.countTotalMissions(visibility),
    reportRepository.countDistinctCompletedMissions(userId),
  ]);

  const categoryCounts = new Map<string, number>();
  for (const record of missionCategories) {
    const category = record.mission.category;
    categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
  }
  const topCategories: TopCategoryDto[] = [...categoryCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([category, count]) => ({ category, count }));

  return {
    id: row.id,
    weekIndex: row.week_index,
    isSaved: !!archiveItem,
    data: {
      ...(row.data as unknown as WeeklyCompareReportDto),
      topCategories,
      missionProgress: { completed: completedMissions, total: totalMissions },
    },
    createdAt: row.created_at.toISOString(),
    previousReportId: previous?.id ?? null,
    nextReportId: next?.id ?? null,
  };
};

// 이미 자동 생성되어 있는 주간 리포트를 Archive로 저장한다. 같은 리포트를 다시 저장해도
// 기존 Archive 항목을 그대로 돌려준다(멱등) — 새 항목을 중복으로 만들지 않는다.
export const saveWeeklyCompareReport = async (
  userId: string,
  id: string
): Promise<SaveWeeklyCompareReportResponseDto> => {
  const row = await reportRepository.findWeeklyCompareReportByIdAndUserId(id, userId);
  if (!row) throw new WeeklyCompareReportNotFoundError();

  const archiveItem = await ensureArchived(userId, "weekly_compare", id);

  return { weeklyCompareReportId: id, savedAt: archiveItem.created_at.toISOString() };
};

// 주간 비교 리포트는 유저가 만든 게 아니라 완결 주차마다 자동 생성되는 스냅샷이다. "삭제"는
// Archive 저장 상태만 해제하는 것이지 스냅샷 자체를 지우는 게 아니다 — 원본을 지우면
// (user_id, week_index) unique 제약 때문에 그 주차는 다시 생성되지도 않아 영구히 사라진다.
export const deleteWeeklyCompareReport = async (
  userId: string,
  id: string
): Promise<DeleteWeeklyCompareReportResponseDto> => {
  const row = await reportRepository.findWeeklyCompareReportByIdAndUserId(id, userId);
  if (!row) throw new WeeklyCompareReportNotFoundError();

  const archiveItem = await findArchiveItemByReference(userId, "weekly_compare", id);
  if (!archiveItem) throw new WeeklyCompareReportNotFoundError("저장되지 않은 주간 비교 리포트입니다.");

  await deleteArchiveItem(archiveItem.id);

  return { weeklyCompareReportId: id, deleted: true };
};

// feedback.service.ts(대화 완료 → 피드백 생성)에서 호출한다. 새로 생성된 리포트마다 알림을 보낸다.
// 알림 발송 실패가 피드백 생성 자체를 막으면 안 되므로 호출부에서 예외를 삼킨다.
export const notifyNewWeeklyCompareReports = async (
  userId: string,
  reportIds: string[]
): Promise<void> => {
  for (const reportId of reportIds) {
    try {
      await notifyReportReady(
        userId,
        "주간 비교 리포트가 도착했어요!",
        "지난 주와 이번 주를 비교한 리포트를 확인해보세요.",
        reportId,
        "weekly_compare"
      );
    } catch (error) {
      logger.warn({ err: error, userId, reportId }, "주간 비교 리포트 알림 발송 실패");
    }
  }
};
