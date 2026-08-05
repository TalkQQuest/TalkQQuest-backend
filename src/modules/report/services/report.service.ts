import { prisma } from "../../../config/database";
import { ReportNotFoundError } from "../errors/report.error";
import * as reportRepository from "../repositories/report.repository";
import { createArchiveItem, deleteArchiveItem, findArchiveItemByReference } from "../../archive/repositories/archive.repository";
import { getGrowthReport, getGrowthWindowStart } from "./growth.service";
import { calculateWeeklyCompare } from "./weekly-compare.service";
import {
  DeleteReportResponseDto,
  GrowthReportDto,
  ListReportsResponseDto,
  ReportDetailResponseDto,
  SaveReportResponseDto,
  WeeklyCompareReportDto,
} from "../dtos/report.dto";
import { createNotification } from "../../notification/repositories/notification.repository";
import { findNotificationSettings } from "../../notification/repositories/notification.repository";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// 스냅샷 리포트 Json 컬럼 안에 저장하는 실제 구조 (#112 — growth/weeklyCompare를 항상 함께 저장한다).
// period(growth 기준 기간)는 Reports.period 컬럼에 별도로 저장되고, weeklyComparePeriod는 이 안에만 있다.
interface StoredReportData {
  title: string;
  weeklyComparePeriod: string;
  growth: GrowthReportDto;
  weeklyCompare: WeeklyCompareReportDto;
}

const toDateOnly = (date: Date): string => date.toISOString().slice(0, 10);

// ISO 8601 주차 표기 (YYYY-Www).
const getIsoWeekLabel = (date: Date): string => {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = d.getTime();
  d.setUTCMonth(0, 1);
  if (d.getUTCDay() !== 4) {
    d.setUTCMonth(0, 1 + ((4 - d.getUTCDay()) + 7) % 7);
  }
  const weekNum = 1 + Math.round((firstThursday - d.getTime()) / WEEK_MS);
  return `${date.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
};

// 대표 제목은 growth 기간(더 넓은 범위, 주간 비교 기간을 포함) 기준으로 뽑는다.
const findRepresentativeTitle = async (userId: string, start: Date, end: Date): Promise<string> => {
  const conversations = await reportRepository.findConversationMissionTitlesInRange(userId, start, end);
  const counts = new Map<string, number>();
  for (const { mission } of conversations) {
    counts.set(mission.title, (counts.get(mission.title) ?? 0) + 1);
  }
  let top: string | null = null;
  let max = 0;
  for (const [title, count] of counts) {
    if (count > max) {
      max = count;
      top = title;
    }
  }
  return top ?? "톡깨 리포트";
};

// #112 — growth/weekly_compare를 더 이상 따로 저장하지 않고 항상 함께 계산해 하나의 리포트로 저장한다.
export const saveReport = async (userId: string): Promise<SaveReportResponseDto> => {
  const now = new Date();
  const growthWindowStart = getGrowthWindowStart(now);

  const [growth, weeklyCompare, title] = await Promise.all([
    getGrowthReport(userId),
    calculateWeeklyCompare(userId),
    findRepresentativeTitle(userId, growthWindowStart, now),
  ]);

  const period = `${toDateOnly(growthWindowStart)}~${toDateOnly(now)}`;
  const weeklyComparePeriod = getIsoWeekLabel(now);
  const stored: StoredReportData = { title, weeklyComparePeriod, growth, weeklyCompare };

  const created = await reportRepository.createReport(userId, period, stored);
  await createArchiveItem({ user: { connect: { id: userId } }, item_type: "report", reference_id: created.id });

    const settings = await findNotificationSettings(userId);
  if (settings?.report_ready) {
    await createNotification(
      userId,
      "report_ready",
      "성장 리포트가 도착했어요!",
      "이번 주 성장 리포트를 확인해보세요.",
      created.id,
      "report"
    );
  }
  
  return { reportId: created.id, period, weeklyComparePeriod, createdAt: created.created_at.toISOString() };
};

export const listReports = async (userId: string): Promise<ListReportsResponseDto> => {
  const rows = await reportRepository.findReportsByUserId(userId);
  return {
    reports: rows.map((row) => {
      const data = row.data as unknown as StoredReportData;
      return {
        id: row.id,
        period: row.period,
        weeklyComparePeriod: data?.weeklyComparePeriod ?? "",
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
    weeklyComparePeriod: data.weeklyComparePeriod,
    title: data?.title ?? "톡깨 리포트",
    growth: data.growth,
    weeklyCompare: data.weeklyCompare,
    createdAt: row.created_at.toISOString(),
  };
};

// 저장(POST /reports)이 Reports + Archive_Items를 함께 만드는 것과 대칭으로, 해제도 둘 다 지운다.
// Archive_Items 쪽에 매핑 row가 없어도(정상적으로는 항상 있어야 함) Reports 삭제 자체는 계속 진행한다.
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
