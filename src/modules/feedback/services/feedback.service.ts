import { FeedbackNotFoundError } from "../errors/feedback.error";
import * as feedbackRepository from "../repositories/feedback.repository";
import { FeedbackDetailResponseDto, FeedbackMetricDto } from "../dtos/feedback.dto";

// overallScore는 4개 지표 점수 컬럼의 평균이다 (metrics Json 안의 score와 같은 값이어야 하지만,
// 집계/정렬에 쓰이는 개별 점수 컬럼을 단일 출처로 삼는다).
const calculateOverallScore = (feedback: {
  kindness_score: number | null;
  initiative_score: number | null;
  empathy_score: number | null;
  question_link_score: number | null;
}): number => {
  const scores = [
    feedback.kindness_score,
    feedback.initiative_score,
    feedback.empathy_score,
    feedback.question_link_score,
  ].filter((score): score is number => score !== null);

  if (scores.length === 0) return 0;
  return Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
};

export const getFeedbackDetail = async (
  userId: string,
  feedbackId: string
): Promise<FeedbackDetailResponseDto> => {
  const feedback = await feedbackRepository.findFeedbackByIdAndUserId(feedbackId, userId);
  if (!feedback) throw new FeedbackNotFoundError();

  return {
    id: feedback.id,
    conversationId: feedback.conversation_id,
    topic: feedback.conversation.selected_topic,
    overallScore: calculateOverallScore(feedback),
    metrics: (feedback.metrics as unknown as FeedbackMetricDto[] | null) ?? [],
    missionSummary: (feedback.mission_summary as unknown as string[] | null) ?? [],
    savedPhrase: feedback.saved_phrase,
    status: feedback.status,
    createdAt: feedback.created_at.toISOString(),
  };
};
