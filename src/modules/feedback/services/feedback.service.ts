// modules/feedback/services/feedback.service.ts
import { logger } from "../../../config/logger";
import { prisma } from "../../../config/database";
import { checkAndAwardBadges } from "../../badge/services/badge.service";
import { findUserCreatedAt } from "../../user/repositories/user.repository";
import { generateMissingWeeklyReports } from "../../report/services/weekly-compare.service";
import { notifyNewWeeklyCompareReports } from "../../report/services/report.service";
import { parseStoredPlaybook } from "../../mission/services/playbook.service";
import * as feedbackRepository from "../repositories/feedback.repository";
import {
  FeedbackConversationNotFoundError,
  FeedbackInputTooShortError,
  FeedbackNotFoundError,
  FeedbackNotReadyError,
} from "../errors/feedback.error";
import { FEEDBACK_METRIC_KEYS, FEEDBACK_METRIC_LABELS } from "../dtos/feedback.constants";
import {
  CreateFeedbackRequestDto,
  FeedbackDetailResponseDto,
  FeedbackMetricDto,
  FeedbackResponseDto,
  FeedbackStatusDto,
  RetryFeedbackResponseDto,
} from "../dtos/feedback.dto";
import {
  FeedbackLlmResult,
  FeedbackMissionContext,
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

// overallScore는 4개 지표 점수 컬럼의 평균이다 (집계/정렬용 개별 점수 컬럼을 단일 출처로 삼는다).
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

interface FeedbackRowForResponse {
  id: string;
  conversation_id: string;
  kindness_score: number | null;
  initiative_score: number | null;
  empathy_score: number | null;
  question_link_score: number | null;
  metrics: unknown; // 저장된 FeedbackMetricDto[]
  mission_summary: unknown;
  saved_phrase: string | null;
  status: string;
}

const emptyMetrics = (): FeedbackMetricDto[] =>
  FEEDBACK_METRIC_KEYS.map((key) => ({
    key,
    label: FEEDBACK_METRIC_LABELS[key],
    score: 0,
    strengths: [],
    improvements: [],
    bestSentence: null,
  }));

// POST /feedback 응답 매핑. topic은 Feedbacks에 저장하지 않고 conversation.selected_topic에서 가져온다.
const toResponseDto = (
  row: FeedbackRowForResponse,
  topic: string | null,
  newlyEarnedBadges: FeedbackResponseDto["newlyEarnedBadges"]
): FeedbackResponseDto => {
  const status = row.status as FeedbackStatusDto;
  const ready = status === "ready";

  return {
    feedbackId: row.id,
    conversationId: row.conversation_id,
    topic,
    overallScore: ready ? calculateOverallScore(row) : 0,
    metrics: ready && Array.isArray(row.metrics) ? (row.metrics as FeedbackMetricDto[]) : emptyMetrics(),
    missionSummary: ready && Array.isArray(row.mission_summary) ? (row.mission_summary as string[]) : [],
    savedPhrase: row.saved_phrase,
    status,
    newlyEarnedBadges,
  };
};

// 점수 컬럼과 함께 저장할 metrics 배열([{key,label,score,strengths,improvements,bestSentence}]).
const buildMetricsArray = (metrics: FeedbackLlmResult["metrics"]): FeedbackMetricDto[] =>
  FEEDBACK_METRIC_KEYS.map((key) => ({
    key,
    label: FEEDBACK_METRIC_LABELS[key],
    score: metrics[key].score,
    strengths: metrics[key].strengths,
    improvements: metrics[key].improvements,
    bestSentence: metrics[key].bestSentence,
  }));

const buildFeedbackMissionContext = (rawPlaybook: unknown): FeedbackMissionContext | undefined => {
  try {
    const playbook = parseStoredPlaybook(rawPlaybook);
    if (!playbook) return undefined;

    const context: FeedbackMissionContext = {
      ...(playbook.objective ? { objective: playbook.objective } : {}),
      ...(playbook.successCriteria?.length
        ? { successCriteria: playbook.successCriteria }
        : {}),
      ...(playbook.feedbackFocus?.length ? { feedbackFocus: playbook.feedbackFocus } : {}),
    };

    return Object.keys(context).length > 0 ? context : undefined;
  } catch (error) {
    logger.warn({ err: error }, "피드백용 플레이북 파싱 실패 — 기존 미션 정보로 생성");
    return undefined;
  }
};

// LLM 호출 + 결과 저장. 실패해도 예외를 던지지 않고 status=failed로 남긴다(호출부가 응답 형태 결정).
// 가짜 점수/분석으로 대체하지 않는다 — 실패는 재시도(POST /feedback/{id}/retry)로 유도한다.
const runGeneration = async (
  feedbackId: string,
  transcript: FeedbackTranscriptMessage[],
  missionTitle: string,
  missionDescription: string | null,
  missionContext?: FeedbackMissionContext
): Promise<void> => {
  const result = await generateFeedbackWithLlm(
    transcript,
    missionTitle,
    missionDescription,
    missionContext
  );

  if (!result) {
    await feedbackRepository.markFeedbackFailed(feedbackId);
    return;
  }

  await feedbackRepository.markFeedbackReady(feedbackId, {
    kindnessScore: result.metrics.kindness.score,
    initiativeScore: result.metrics.initiative.score,
    empathyScore: result.metrics.empathy.score,
    questionLinkScore: result.metrics.questionLink.score,
    metrics: buildMetricsArray(result.metrics),
    missionSummary: result.missionSummary,
    summaryChips: result.summaryChips,
    conversationSummary: result.conversationSummary,
    savedPhrase: result.savedPhrase,
  });
};

// #145 — 주간 비교 리포트는 스케줄러 없이, "대화 완료 → 피드백 생성" 시점을 트리거로 삼아
// 지연 계산으로 생성한다. 미션 리마인드용 스케줄러 인프라가 생기면 이 호출부를 스케줄러로
// 옮기는 것이 맞다(생성 로직 자체는 이미 트리거와 무관한 순수 함수라 호출부만 바꾸면 된다).
// 실패해도 피드백 생성 자체(사용자가 기다리는 응답)를 막으면 안 되므로 예외를 삼킨다.
const triggerWeeklyCompareGeneration = async (userId: string): Promise<void> => {
  try {
    const signupAt = await findUserCreatedAt(userId);
    if (!signupAt) return;

    const created = await generateMissingWeeklyReports(userId, signupAt);
    if (created.length > 0) {
      await notifyNewWeeklyCompareReports(
        userId,
        created.map((r) => r.id)
      );
    }
  } catch (error) {
    logger.warn({ err: error, userId }, "주간 비교 리포트 생성 실패 (피드백 생성 자체는 정상 처리)");
  }
};

// POST /feedback — 대화당 1건(find-or-create). 이미 ready면 그대로 반환(멱등),
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
      return toResponseDto(existing, conversation.selected_topic, []);
    }
    await feedbackRepository.markFeedbackPending(existing.id);
    feedbackId = existing.id;
  } else {
    const created = await feedbackRepository.createPendingFeedback(userId, body.conversationId);
    feedbackId = created.id;
  }

  await runGeneration(
    feedbackId,
    conversation.messages as FeedbackTranscriptMessage[],
    conversation.mission.title,
    conversation.mission.description,
    buildFeedbackMissionContext(conversation.mission.playbook?.data)
  );

  const saved = await feedbackRepository.findFeedbackByIdAndUserId(feedbackId, userId);
  // 피드백 기반 뱃지(누적 생성 횟수, 지표 달성 횟수 등)는 여기서 생성 직후 바로 판정한다.
  // 미션 완료(mission-completion.service.ts)와 동일하게, 조건을 만족하면 응답에 실어서
  // 완료 화면에서 바로 축하 모달을 띄울 수 있게 한다. GET /badges/me도 별도로 지연 판정하므로
  // 여기서 놓쳐도(예: 재시도 백그라운드 완료 시점) 다음 조회에서 채워진다.
  const newlyEarnedBadges = await checkAndAwardBadges(prisma, userId);

  // 밀린 주차가 많으면 순차 조회 비용이 커질 수 있어(주차마다 DB round-trip) 응답을 막지 않는다.
  // retryFeedback의 재생성과 동일하게 fire-and-forget으로 처리한다(전용 워커/큐가 없음).
  // 실패해도 다음 피드백 생성 시점에 재시도되므로 유실되지 않는다.
  if (saved?.status === "ready") {
    void triggerWeeklyCompareGeneration(userId);
  }

  return toResponseDto(saved!, saved!.conversation.selected_topic, newlyEarnedBadges);
};

// POST /feedback/{feedbackId}/retry — 상태를 pending으로 바꾸고 즉시 응답한다.
// 실제 재생성은 응답 이후 백그라운드에서 진행된다(전용 워커/큐가 없어 fire-and-forget으로 처리).
// 결과 확인은 GET /feedback/{feedbackId}로 폴링한다.
export const retryFeedback = async (
  userId: string,
  feedbackId: string
): Promise<RetryFeedbackResponseDto> => {
  const feedback = await feedbackRepository.findFeedbackByIdAndUserId(feedbackId, userId);
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
    conversation.mission.description,
    buildFeedbackMissionContext(conversation.mission.playbook?.data)
  ).catch((error: unknown) => {
    logger.error({ err: error, feedbackId }, "피드백 재생성 중 예기치 못한 오류");
    void feedbackRepository.markFeedbackFailed(feedbackId).catch(() => {});
  });

  return { feedbackId, status: "pending" };
};

// GET /feedback/{feedbackId} — 상세 조회 (분업 담당분 구현 유지).
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
