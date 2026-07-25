// modules/feedback/dtos/feedback.dto.ts
import { z } from "zod";
import { FeedbackMetricKey } from "./feedback.constants";

// 지표 하나의 상세. Feedbacks.metrics(Json)에 이 형태의 배열로 저장되고, 응답에도 그대로 쓰인다.
export interface FeedbackMetricDto {
  key: FeedbackMetricKey;
  label: string;
  score: number;
  strengths: string[];
  improvements: string[];
  bestSentence: string | null;
}

export type FeedbackStatusDto = "pending" | "ready" | "failed";

// POST /feedback
export interface CreateFeedbackRequestDto {
  conversationId: string;
}

export const createFeedbackRequestSchema = z.object({
  conversationId: z.string().uuid({ message: "conversationId는 UUID 형식이어야 합니다." }),
}) satisfies z.ZodType<CreateFeedbackRequestDto>;

export interface FeedbackResponseDto {
  feedbackId: string;
  conversationId: string;
  topic: string | null;
  overallScore: number; // 4개 지표 점수 평균 (0-100), ready가 아니면 0
  metrics: FeedbackMetricDto[]; // 항상 4개, kindness/initiative/empathy/questionLink 순서 고정
  missionSummary: string[];
  savedPhrase: string | null;
  status: FeedbackStatusDto;
}

// GET /feedback/{feedbackId} — 상세 조회
export interface FeedbackDetailResponseDto {
  id: string;
  conversationId: string;
  topic: string | null;
  overallScore: number;
  metrics: FeedbackMetricDto[];
  missionSummary: string[];
  savedPhrase: string | null;
  status: FeedbackStatusDto;
  createdAt: string;
}

// POST /feedback/{feedbackId}/retry
export interface RetryFeedbackResponseDto {
  feedbackId: string;
  status: FeedbackStatusDto;
}
