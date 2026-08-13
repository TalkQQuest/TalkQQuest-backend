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

// GET /reports/weekly-compare/{reportId} 응답. 저장된 스냅샷(WeeklyCompareReportDto)에
// topCategories/missionProgress를 조회 시점에 라이브 계산해 얹는다(#201) — 전체 미션 수/
// 완료 미션 수는 계속 변하므로 생성 시점 값을 그대로 저장하면 나중에 조회할 때 낡은 값이 나온다.
export interface WeeklyCompareResponseDto extends WeeklyCompareReportDto {
  topCategories: TopCategoryDto[];
  missionProgress: MissionProgressDto;
}

// #145 — 성장 리포트는 대화 하나를 기준으로 저장된다(conversationId, 같은 대화로 중복 저장 불가).
// period(YYYY-MM-DD~YYYY-MM-DD)는 요청 필드가 아니라 저장 시점에 서버가 계산해 응답에 담는다.
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

// #216 — 이 리포트를 만든 대화 하나에서 획득한 4개 지표 점수. growthTotals(누적)와 달리
// 이 리포트의 대화 하나에 대한 값이라 growth 밖에 별도 필드로 둔다 — GrowthReportDto는
// GET /reports/growth(특정 대화와 무관한 라이브 집계)와 공유하는 타입이라 여기 넣지 않는다.
// 저장 시점에 해당 conversationId의 Feedbacks 점수를 그대로 옮겨 스냅샷으로 고정하고,
// 이후 그 대화의 피드백이 재시도로 갱신되어도 저장된 값은 바뀌지 않는다.
export interface RecentScoresDto {
  kindness: number;
  initiative: number;
  empathy: number;
  questionLink: number;
}

export interface ReportDetailResponseDto {
  id: string;
  period: string;
  title: string;
  growth: GrowthReportDto;
  recentScores: RecentScoresDto;
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
  data: WeeklyCompareResponseDto;
  createdAt: string;
  /** 이전 주차(week_index - 1) 리포트 id. 없으면 null(#177). isSaved와 무관하게 존재 여부만 본다. */
  previousReportId: string | null;
  /** 다음 주차(week_index + 1) 리포트 id. 없으면 null(#177). isSaved와 무관하게 존재 여부만 본다. */
  nextReportId: string | null;
  /**
   * 화면 상단에 그대로 표시하는 완성된 주차 문구(#195). 예: "7월 4주차 → 8월 1주차".
   * 비교 대상(data.lastWeek)이 몇 번째 주였는지를 실제로 찾아서 만든다 — 바로 직전 주가
   * 아닐 수 있으므로(활동 없는 주는 건너뜀) weekIndex-1로 가정하지 않는다.
   * 가입 후 첫 리포트라 비교 대상 주 자체가 없으면 이번 주 문구만 내려간다(예: "8월 1주차").
   */
  periodLabel: string;
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
