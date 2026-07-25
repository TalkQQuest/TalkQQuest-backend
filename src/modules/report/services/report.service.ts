import { prisma } from "../../../config/database";
import { ReportNotFoundError } from "../errors/report.error";
import * as reportRepository from "../repositories/report.repository";
import { createArchiveItem, deleteArchiveItem, findArchiveItemByReference } from "../../archive/repositories/archive.repository";
import { getGrowthReport, getGrowthWindowStart } from "./growth.service";
import { calculateWeeklyCompare, getThisWeekStart } from "./weekly-compare.service";
import { addDays } from "./week-window";
import {
  DeleteReportResponseDto,
  GrowthReportDto,
  ListReportsQueryDto,
  ListReportsResponseDto,
  ReportDetailResponseDto,
  ReportType,
  SaveReportRequestDto,
  SaveReportResponseDto,
  WeeklyCompareReportDto,
} from "../dtos/report.dto";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// 스냅샷 리포트 Json 컬럼 안에 저장하는 실제 구조 — 목록 화면 title은 별도 컬럼이 없어서 데이터와 함께 저장한다.
interface StoredReportData {
  title: string;
  report: GrowthReportDto | WeeklyCompareReportDto;
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

const findRepresentativeTitle = async (userId: string, start: Date, end: Date): Promise<string> => {
  const conversations = await reportRepository.findConversationTopicsInRange(userId, start, end);
  const counts = new Map<string, number>();
  for (const { selected_topic } of conversations) {
    if (!selected_topic) continue;
    counts.set(selected_topic, (counts.get(selected_topic) ?? 0) + 1);
  }
  let top: string | null = null;
  let max = 0;
  for (const [topic, count] of counts) {
    if (count > max) {
      max = count;
      top = topic;
    }
  }
  return top ?? "톡깨 리포트";
};

export const saveReport = async (
  userId: string,
  body: SaveReportRequestDto
): Promise<SaveReportResponseDto> => {
  const now = new Date();

  if (body.type === "growth") {
    const windowStart = getGrowthWindowStart(now);
    const [report, title] = await Promise.all([
      getGrowthReport(userId),
      findRepresentativeTitle(userId, windowStart, now),
    ]);
    const period = `${toDateOnly(windowStart)}~${toDateOnly(now)}`;
    const stored: StoredReportData = { title, report };
    const created = await reportRepository.createReport(userId, "growth", period, stored);
    await createArchiveItem({ user: { connect: { id: userId } }, item_type: "report", reference_id: created.id });
    return { reportId: created.id, type: "growth", period, createdAt: created.created_at.toISOString() };
  }

  const thisWeekStart = getThisWeekStart(now);
  const [report, title] = await Promise.all([
    calculateWeeklyCompare(userId),
    findRepresentativeTitle(userId, thisWeekStart, addDays(thisWeekStart, 7)),
  ]);
  const period = getIsoWeekLabel(now);
  const stored: StoredReportData = { title, report };
  const created = await reportRepository.createReport(userId, "weekly_compare", period, stored);
  await createArchiveItem({ user: { connect: { id: userId } }, item_type: "report", reference_id: created.id });
  return { reportId: created.id, type: "weekly_compare", period, createdAt: created.created_at.toISOString() };
};

export const listReports = async (
  userId: string,
  query: ListReportsQueryDto
): Promise<ListReportsResponseDto> => {
  const rows = await reportRepository.findReportsByUserId(userId, query.type as ReportType | undefined);
  return {
    reports: rows.map((row) => {
      const data = row.data as unknown as StoredReportData;
      return {
        id: row.id,
        type: row.type as ReportType,
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
  const type = row.type as ReportType;

  return {
    id: row.id,
    type,
    period: row.period,
    growth: type === "growth" ? (data.report as GrowthReportDto) : null,
    weeklyCompare: type === "weekly_compare" ? (data.report as WeeklyCompareReportDto) : null,
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
