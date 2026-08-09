// modules/feedback/repositories/feedback.repository.ts
import { Prisma } from "@prisma/client";
import { prisma } from "../../../config/database";

// POST /feedback 생성 전 대화 소유권/맥락 확인 + 분석에 쓸 메시지 전체를 함께 가져온다.
// scalar 필드(selected_topic 등)는 include 사용 시 기본 반환되므로 topic도 여기서 얻는다.
export const findConversationForFeedback = (conversationId: string, userId: string) =>
  prisma.conversations.findFirst({
    where: { id: conversationId, user_id: userId },
    include: {
      mission: { select: { title: true, description: true } },
      messages: {
        orderBy: { created_at: "asc" },
        select: { role: true, content: true },
      },
    },
  });

// 대화당 피드백 1건 원칙(스키마엔 unique 없으나 find-or-create로 중복 생성 방지).
export const findFeedbackByConversationId = (conversationId: string) =>
  prisma.feedbacks.findFirst({ where: { conversation_id: conversationId } });

// GET /feedback/{feedbackId} + 생성/재시도 후 재조회. topic 표시를 위해 conversation.selected_topic 포함.
export const findFeedbackByIdAndUserId = (feedbackId: string, userId: string) =>
  prisma.feedbacks.findFirst({
    where: { id: feedbackId, user_id: userId },
    include: { conversation: { select: { selected_topic: true } } },
  });

export const createPendingFeedback = (userId: string, conversationId: string) =>
  prisma.feedbacks.create({
    data: {
      user_id: userId,
      conversation_id: conversationId,
      status: "pending",
    },
  });

export const markFeedbackPending = (feedbackId: string) =>
  prisma.feedbacks.update({ where: { id: feedbackId }, data: { status: "pending" } });

export const markFeedbackFailed = (feedbackId: string) =>
  prisma.feedbacks.update({ where: { id: feedbackId }, data: { status: "failed" } });

// 생성 성공 시 결과를 채워 status=ready로 전환한다.
// 개별 점수 컬럼(집계/정렬용 단일 출처)과 metrics 배열(지표별 상세)을 함께 저장한다.
export const markFeedbackReady = (
  feedbackId: string,
  data: {
    kindnessScore: number;
    initiativeScore: number;
    empathyScore: number;
    questionLinkScore: number;
    metrics: unknown; // [{ key, label, score, strengths, improvements, bestSentence }]
    missionSummary: string[];
    summaryChips: string[]; // 대화 요약 키워드 칩 3개(단어 형태)
    conversationSummary: string; // 대화 전체 2~3문장 요약
    savedPhrase: string;
  }
) =>
  prisma.feedbacks.update({
    where: { id: feedbackId },
    data: {
      kindness_score: data.kindnessScore,
      initiative_score: data.initiativeScore,
      empathy_score: data.empathyScore,
      question_link_score: data.questionLinkScore,
      metrics: data.metrics as Prisma.InputJsonValue,
      mission_summary: data.missionSummary as unknown as Prisma.InputJsonValue,
      summary_chips: data.summaryChips as unknown as Prisma.InputJsonValue,
      conversation_summary: data.conversationSummary,
      saved_phrase: data.savedPhrase,
      status: "ready",
      // status와 같은 update로 함께 기록한다. 성장 프로필(User_Growth_Profiles)의 증분 갱신이
      // 이 값을 커서로 쓰므로, 여기서 빠지면 새로 ready가 된 피드백이 영영 집계되지 않는다.
      //
      // 재전환으로 값이 덮이는 경우: feedback.service.ts가 이미 ready인 피드백은 조회 후
      // 바로 반환하므로 정상 흐름에서는 발생하지 않는다. 설령 덮이더라도 ready_at은 앞으로만
      // 이동하므로 커서 뒤로 밀려 다시 읽힐 뿐이고(재요약은 멱등), 뒤로 가서 건너뛰는 일은 없다.
      ready_at: new Date(),
    },
  });
