import { z } from "zod";

export interface WeeklyTrendPointDto {
  week: string;
  score: number;
}

export interface TopCategoryDto {
  category: string;
  count: number;
}

export interface MissionProgressDto {
  completed: number;
  total: number;
}

export interface GrowthReportDto {
  levelBefore: number;
  levelAfter: number;
  weeklyTrend: WeeklyTrendPointDto[];
  trendChangeRate: number;
  topCategories: TopCategoryDto[];
  missionProgress: MissionProgressDto;
}

export interface WeeklyMetricsDto {
  kindness: number;
  initiative: number;
  empathy: number;
  questionLink: number;
}

export interface WeeklyActivityDto {
  completedMissionCount: number;
  xpEarned: number;
  metrics: WeeklyMetricsDto;
}

export interface OverallScoreChangeDto {
  from: number;
  to: number;
  delta: number;
}

export interface MetricChangeDto {
  key: "kindness" | "initiative" | "empathy" | "questionLink";
  label: string;
  from: number;
  to: number;
  delta: number;
}

export interface WeeklyCompareReportDto {
  thisWeek: WeeklyActivityDto;
  lastWeek: WeeklyActivityDto;
  xpChangeRate: number;
  overallScoreChange: OverallScoreChangeDto;
  metricChanges: MetricChangeDto[];
  highlights: string[];
}

export type ReportType = "growth" | "weekly_compare";

export interface SaveReportRequestDto {
  type: ReportType;
}

export const saveReportRequestSchema = z.object({
  type: z.enum(["growth", "weekly_compare"], {
    errorMap: () => ({ message: "유효하지 않은 리포트 종류입니다." }),
  }),
}) satisfies z.ZodType<SaveReportRequestDto>;

export interface SaveReportResponseDto {
  reportId: string;
  type: ReportType;
  period: string;
  createdAt: string;
}

export interface ListReportsQueryDto {
  type?: ReportType;
}

export const listReportsQuerySchema = z.object({
  type: z.enum(["growth", "weekly_compare"]).optional(),
}) satisfies z.ZodType<ListReportsQueryDto>;

export interface ReportListItemDto {
  id: string;
  type: ReportType;
  period: string;
  title: string;
  createdAt: string;
}

export interface ListReportsResponseDto {
  reports: ReportListItemDto[];
}

export interface ReportDetailResponseDto {
  id: string;
  type: ReportType;
  period: string;
  growth: GrowthReportDto | null;
  weeklyCompare: WeeklyCompareReportDto | null;
  createdAt: string;
}

// DELETE /reports/{reportId}
export interface DeleteReportResponseDto {
  reportId: string;
  deleted: true;
}
