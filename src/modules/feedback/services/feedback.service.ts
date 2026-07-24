// modules/feedback/services/feedback.service.ts
import { z } from "zod";
import { logger } from "../../../config/logger";
import * as feedbackRepository from "../repositories/feedback.repository";
import {
  FeedbackConversationNotFoundError,
  FeedbackInputTooShortError,
  FeedbackNotFoundError,
  FeedbackNotReadyError,
} from "../errors/feedback.error";
import {
  FEEDBACK_METRIC_KEYS,
  FEEDBACK_METRIC_LABELS,
  FeedbackMetricKey,
} from "../dtos/feedback.constants";
import {
  CreateFeedbackRequestDto,
  FeedbackMetricDto,
  FeedbackResponseDto,
  FeedbackStatusDto,
  RetryFeedbackResponseDto,
} from "../dtos/feedback.dto";
import {
  FeedbackLlmResult,
  FeedbackTranscriptMessage,
  generateFeedbackWithLlm,
} from "./feedback-llm.service";

// 대화가 분석하기에 너무 짧은지 판단하는 기준. 사용자 발화(guide/system 제외)만 센다.
const MIN_USER_MESSAGES = 2;
const MIN_USER_CHARS = 20;

const assertSufficientInput = (messages: { role: string; content: string }[]): void => {
  const userMessages = messages.filter((m) => m.role === "user");
  const totalChars = userMessages.reduce((sum, m) => sum + m.content.trim().length, 0);
  if (userMessages.length < MIN_USER_MESSAGES || totalChars < MIN_USER_CHARS) {
    throw new FeedbackInputTooShortError();
  }
};

// metrics_detail(Json)은 서버가 직접 만든 값만 저장하지만, JSON 컬럼이라 타입이 보장되지 않으므로
// 방어적으로 파싱한다 — 형식이 깨져 있으면 해당 지표를 빈 값으로 처리한다(응답 자체는 계속 내려줌).
const metricDetailSchema = z.object({
  strengths: z.array(z.string()),
  improvements: z.array(z.string()),
  bestSentence: z.string(),
});
const metricsDetailSchema = z.object({
  kindness: metricDetailSchema,
  initiative: metricDetailSchema,
  empathy: metricDetailSchema,
  questionLink: metricDetailSchema,
});

type FeedbackRow = NonNullable<
  Awaited<ReturnType<typeof feedbackRepository.findFeedbackByIdAndUser>>
>;

const toResponseDto = (row: FeedbackRow): FeedbackResponseDto => {
  const status = row.status as FeedbackStatusDto;

  if (status !== "ready") {
    return {
      feedbackId: row.id,
      conversationId: row.conversation_id,
      topic: row.topic,
      overallScore: 0,
      metrics: FEEDBACK_METRIC_KEYS.map(
        (key): FeedbackMetricDto => ({
          key,
          label: FEEDBACK_METRIC_LABELS[key],
          score: 0,
          strengths: [],
          improvements: [],
          bestSentence: null,
        })
      ),
      missionSummary: [],
      savedPhrase: row.saved_phrase,
      status,
    };
  }

  const scores: Record<FeedbackMetricKey, number> = {
    kindness: row.kindness_score ?? 0,
    initiative: row.initiative_score ?? 0,
    empathy: row.empathy_score ?? 0,
    questionLink: row.question_link_score ?? 0,
  };
  const detailParsed = metricsDetailSchema.safeParse(row.metrics_detail);
  const detail = detailParsed.success ? detailParsed.data : null;

  const overallScore = Math.round(
    (scores.kindness + scores.initiative + scores.empathy + scores.questionLink) / 4
  );

  return {
    feedbackId: row.id,
    conversationId: row.conversation_id,
    topic: row.topic,
    overallScore,
    metrics: FEEDBACK_METRIC_KEYS.map(
      (key): FeedbackMetricDto => ({
        key,
        label: FEEDBACK_METRIC_LABELS[key],
        score: scores[key],
        strengths: detail?.[key]?.strengths ?? [],
        improvements: detail?.[key]?.improvements ?? [],
        bestSentence: detail?.[key]?.bestSentence ?? null,
      })
    ),
    missionSummary: Array.isArray(row.mission_summary) ? (row.mission_summary as string[]) : [],
    savedPhrase: row.saved_phrase,
    status,
  };
};

// LLM 결과에서 score를 뺀 나머지(strengths/improvements/bestSentence)만 metrics_detail로 저장한다.
// score는 이미 전용 컬럼(kindness_score 등)에 저장하므로 중복 보관하지 않는다.
const toMetricsDetail = (metrics: FeedbackLlmResult["metrics"]) => ({
  kindness: {
    strengths: metrics.kindness.strengths,
    improvements: metrics.kindness.improvements,
    bestSentence: metrics.kindness.bestSentence,
  },
  initiative: {
    strengths: metrics.initiative.strengths,
    improvements: metrics.initiative.improvements,
    bestSentence: metrics.initiative.bestSentence,
  },
  empathy: {
    strengths: metrics.empathy.strengths,
    improvements: metrics.empathy.improvements,
    bestSentence: metrics.empathy.bestSentence,
  },
  questionLink: {
    strengths: metrics.questionLink.strengths,
    improvements: metrics.questionLink.improvements,
    bestSentence: metrics.questionLink.bestSentence,
  },
});

// LLM 호출 + 결과 저장. 실패해도 예외를 던지지 않고 status=failed로 남긴다(호출부가 응답 형태 결정).
// 가짜 점수/분석으로 대체하지 않는다 — 실패는 재시도(POST /feedback/{id}/retry)로 유도한다.
const runGeneration = async (
  feedbackId: string,
  transcript: FeedbackTranscriptMessage[],
  missionTitle: string,
  missionDescription: string | null
): Promise<void> => {
  const result = await generateFeedbackWithLlm(transcript, missionTitle, missionDescription);

  if (!result) {
    await feedbackRepository.markFeedbackFailed(feedbackId);
    return;
  }

  await feedbackRepository.markFeedbackReady(feedbackId, {
    kindnessScore: result.metrics.kindness.score,
    initiativeScore: result.metrics.initiative.score,
    empathyScore: result.metrics.empathy.score,
    questionLinkScore: result.metrics.questionLink.score,
    metricsDetail: toMetricsDetail(result.metrics),
    missionSummary: result.missionSummary,
    savedPhrase: result.savedPhrase,
  });
};

// POST /feedback — 대화당 최대 1건(find-or-create). 이미 ready면 그대로 반환(멱등),
// pending이면 409, failed였다면 같은 행으로 재생성을 시도한다.
// 생성은 이 요청 안에서 동기로 끝난다(미션 추천과 동일하게 폴링/큐 없이 즉시 응답).
export const createFeedback = async (
  userId: string,
  body: CreateFeedbackRequestDto
): Promise<FeedbackResponseDto> => {
  const conversation = await feedbackRepository.findConversationForFeedback(
    body.conversationId,
    userId
  );
  if (!conversation) throw new FeedbackConversationNotFoundError();

  assertSufficientInput(conversation.messages);

  const existing = await feedbackRepository.findFeedbackByConversationId(body.conversationId);

  let feedbackId: string;
  if (existing) {
    if (existing.status === "pending") {
      throw new FeedbackNotReadyError("피드백이 아직 준비되지 않았습니다.");
    }
    if (existing.status === "ready") {
      return toResponseDto(existing);
    }
    await feedbackRepository.markFeedbackPending(existing.id);
    feedbackId = existing.id;
  } else {
    const created = await feedbackRepository.createPendingFeedback(
      userId,
      body.conversationId,
      conversation.selected_topic
    );
    feedbackId = created.id;
  }

  await runGeneration(
    feedbackId,
    conversation.messages as FeedbackTranscriptMessage[],
    conversation.mission.title,
    conversation.mission.description
  );

  const saved = await feedbackRepository.findFeedbackByIdAndUser(feedbackId, userId);
  return toResponseDto(saved!);
};

// POST /feedback/{feedbackId}/retry — 상태를 pending으로 바꾸고 즉시 응답한다.
// 실제 재생성은 응답 이후 백그라운드에서 진행된다(전용 워커/큐가 없어 fire-and-forget으로 처리).
// 결과 확인은 GET /feedback/{feedbackId}(이번 범위 밖, 후속 이슈)를 전제로 한다.
export const retryFeedback = async (
  userId: string,
  feedbackId: string
): Promise<RetryFeedbackResponseDto> => {
  const feedback = await feedbackRepository.findFeedbackByIdAndUser(feedbackId, userId);
  if (!feedback) throw new FeedbackNotFoundError();

  if (feedback.status === "pending") {
    throw new FeedbackNotReadyError("아직 처리 중인 피드백입니다.");
  }

  const conversation = await feedbackRepository.findConversationForFeedback(
    feedback.conversation_id,
    userId
  );
  if (!conversation) throw new FeedbackConversationNotFoundError();

  await feedbackRepository.markFeedbackPending(feedbackId);

  void runGeneration(
    feedbackId,
    conversation.messages as FeedbackTranscriptMessage[],
    conversation.mission.title,
    conversation.mission.description
  ).catch((error: unknown) => {
    logger.error({ err: error, feedbackId }, "피드백 재생성 중 예기치 못한 오류");
    void feedbackRepository.markFeedbackFailed(feedbackId).catch(() => {});
  });

  return { feedbackId, status: "pending" };
};
