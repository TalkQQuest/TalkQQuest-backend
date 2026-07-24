export interface FeedbackMetricDto {
  key: "kindness" | "initiative" | "empathy" | "questionLink";
  label: string;
  score: number;
  strengths: string[];
  improvements: string[];
  bestSentence: string | null;
}

export interface FeedbackDetailResponseDto {
  id: string;
  conversationId: string;
  topic: string | null;
  overallScore: number;
  metrics: FeedbackMetricDto[];
  missionSummary: string[];
  savedPhrase: string | null;
  status: "pending" | "ready" | "failed";
  createdAt: string;
}
