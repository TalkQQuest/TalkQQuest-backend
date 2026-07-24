// modules/feedback/dtos/feedback.constants.ts

// 4개 지표는 항상 이 순서로 고정 (POST /feedback 참고: "metrics는 항상 4개 고정 순서로 반환된다").
export const FEEDBACK_METRIC_KEYS = ["kindness", "initiative", "empathy", "questionLink"] as const;
export type FeedbackMetricKey = (typeof FEEDBACK_METRIC_KEYS)[number];

export const FEEDBACK_METRIC_LABELS: Record<FeedbackMetricKey, string> = {
  kindness: "친절한 태도",
  initiative: "대화 주도",
  empathy: "공감 능력",
  questionLink: "질문 연결성",
};
