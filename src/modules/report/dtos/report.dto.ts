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

// #145 — 능력별 누적 점수. Feedbacks의 4개 지표 점수를 유저 전체 기간에 걸쳐 합산한 값으로,
// 300 단위로 마름모가 차는지/별이 몇 개인지/티어가 뭔지는 전부 클라이언트가 계산한다.
// 서버는 원값(계속 늘어나기만 하는 누적 합계)만 내려준다.
export interface GrowthMetricTotalsDto {
  kindnessTotal: number;
  initiativeTotal: number;
  empathyTotal: number;
  questionLinkTotal: number;
}

export interface GrowthReportDto {
  levelBefore: number;
  levelAfter: number;
  weeklyTrend: WeeklyTrendPointDto[];
  trendChangeRate: number;
  topCategories: TopCategoryDto[];
  missionProgress: MissionProgressDto;
  growthTotals: GrowthMetricTotalsDto;
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

// #145 — 성장 리포트는 대화 하나를 기준으로 저장된다(conversationId, 같은 대화로 중복 저장 불가).
// period는 growth 계산 기준 기간(YYYY-MM-DD~YYYY-MM-DD).
export interface SaveReportRequestDto {
  conversationId: string;
}

export const saveReportRequestSchema = z.object({
  conversationId: z.string().min(1),
}) satisfies z.ZodType<SaveReportRequestDto>;

export interface SaveReportResponseDto {
  reportId: string;
  period: string;
  createdAt: string;
}

export interface ReportListItemDto {
  id: string;
  period: string;
  title: string;
  createdAt: string;
}

export interface ListReportsResponseDto {
  reports: ReportListItemDto[];
}

export interface ReportDetailResponseDto {
  id: string;
  period: string;
  title: string;
  growth: GrowthReportDto;
  createdAt: string;
}

// DELETE /reports/{reportId}
export interface DeleteReportResponseDto {
  reportId: string;
  deleted: true;
}

// ── 주간 비교 리포트 (#145) ──
// 가입일 기준으로 완결된 주차끼리 비교하며, 대화 완료 시점마다 지연 계산으로 자동 생성된다.
// 목록/상세는 자동 생성된 것을 그대로 조회하고, Archive에 남기려면 별도로 저장 액션을 호출한다.

export interface WeeklyCompareReportListItemDto {
  id: string;
  weekIndex: number;
  overallScoreChange: OverallScoreChangeDto;
  isSaved: boolean;
  createdAt: string;
}

export interface ListWeeklyCompareReportsResponseDto {
  reports: WeeklyCompareReportListItemDto[];
}

export interface WeeklyCompareReportDetailResponseDto {
  id: string;
  weekIndex: number;
  isSaved: boolean;
  data: WeeklyCompareReportDto;
  createdAt: string;
}

// POST /reports/weekly-compare/{id}/save
export interface SaveWeeklyCompareReportResponseDto {
  weeklyCompareReportId: string;
  savedAt: string;
}

// DELETE /reports/weekly-compare/{id}
export interface DeleteWeeklyCompareReportResponseDto {
  weeklyCompareReportId: string;
  deleted: true;
}
