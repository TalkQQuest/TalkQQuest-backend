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

// #112 — growth/weekly_compare가 더 이상 별개 타입이 아니라 하나의 리포트로 통합되어 저장된다.
// period는 growth 계산 기준 기간(YYYY-MM-DD~YYYY-MM-DD), weeklyComparePeriod는 주간 비교 계산 기준 기간(YYYY-Www)이다.
export interface SaveReportResponseDto {
  reportId: string;
  period: string;
  weeklyComparePeriod: string;
  createdAt: string;
}

export interface ReportListItemDto {
  id: string;
  period: string;
  weeklyComparePeriod: string;
  title: string;
  createdAt: string;
}

export interface ListReportsResponseDto {
  reports: ReportListItemDto[];
}

export interface ReportDetailResponseDto {
  id: string;
  period: string;
  weeklyComparePeriod: string;
  title: string;
  growth: GrowthReportDto;
  weeklyCompare: WeeklyCompareReportDto;
  createdAt: string;
}

// DELETE /reports/{reportId}
export interface DeleteReportResponseDto {
  reportId: string;
  deleted: true;
}
