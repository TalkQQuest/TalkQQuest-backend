// modules/report/dtos/report.dto.ts
import { FeedbackMetricKey } from "../../feedback/dtos/feedback.constants";

export interface WeeklySnapshotDto {
  completedMissionCount: number;
  xpEarned: number;
  metrics: Record<FeedbackMetricKey, number>;
}

export interface MetricChangeDto {
  key: FeedbackMetricKey;
  label: string;
  from: number;
  to: number;
  delta: number;
}

export interface ScoreChangeDto {
  from: number;
  to: number;
  delta: number;
}

// GET /reports/weekly-compare
export interface WeeklyCompareResponseDto {
  thisWeek: WeeklySnapshotDto;
  lastWeek: WeeklySnapshotDto;
  xpChangeRate: number;
  overallScoreChange: ScoreChangeDto;
  metricChanges: MetricChangeDto[];
  highlights: string[];
}
