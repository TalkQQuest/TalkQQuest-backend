// Badges.condition(Json)에 저장되는 판정 규칙 형태.
// 이슈 #73: 14종 중 13종을 이 7개 타입으로 표현한다.
export type BadgeCondition =
  | { type: "mission_complete_count"; target: number }
  | { type: "mission_complete_count_by_categories"; categories: string[]; target: number }
  | { type: "distinct_mission_category_count"; target: number }
  | { type: "mission_streak_days"; target: number }
  | {
      type: "feedback_metric_threshold_count";
      metric: "kindness" | "initiative" | "empathy" | "questionLink";
      threshold: number;
      target: number;
    }
  | { type: "feedback_all_metrics_threshold_count"; threshold: number; target: number }
  | { type: "feedback_created_count"; target: number };

export interface BadgeProgressDto {
  current: number;
  target: number;
}
