// modules/feedback/dtos/feedback.dto.ts
import { z } from "zod";
import { FeedbackMetricKey } from "./feedback.constants";

// POST /feedback
export interface CreateFeedbackRequestDto {
  conversationId: string;
}

export const createFeedbackRequestSchema = z.object({
  conversationId: z.string().uuid({ message: "conversationId는 UUID 형식이어야 합니다." }),
}) satisfies z.ZodType<CreateFeedbackRequestDto>;

export interface FeedbackMetricDto {
  key: FeedbackMetricKey;
  label: string;
  score: number;
  strengths: string[];
  improvements: string[];
  bestSentence: string | null;
}

export type FeedbackStatusDto = "pending" | "ready" | "failed";

export interface FeedbackResponseDto {
  feedbackId: string;
  conversationId: string;
  topic: string | null;
  overallScore: number; // 4개 지표 평균 (0-100), status가 ready가 아니면 0
  metrics: FeedbackMetricDto[]; // 항상 4개, kindness/initiative/empathy/questionLink 순서 고정
  missionSummary: string[];
  savedPhrase: string | null;
  status: FeedbackStatusDto;
}

// POST /feedback/{feedbackId}/retry
export interface RetryFeedbackResponseDto {
  feedbackId: string;
  status: FeedbackStatusDto;
}
