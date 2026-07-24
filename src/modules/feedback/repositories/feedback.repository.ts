// modules/feedback/repositories/feedback.repository.ts
import { Prisma } from "@prisma/client";
import { prisma } from "../../../config/database";

// POST /feedback 생성 전 대화 소유권/맥락 확인 + 분석에 쓸 메시지 전체를 함께 가져온다.
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

// 대화당 최대 1건(스키마 @@unique([conversation_id])) — POST /feedback의 find-or-create에 사용.
export const findFeedbackByConversationId = (conversationId: string) =>
  prisma.feedbacks.findUnique({ where: { conversation_id: conversationId } });

export const findFeedbackByIdAndUser = (feedbackId: string, userId: string) =>
  prisma.feedbacks.findFirst({ where: { id: feedbackId, user_id: userId } });

export const createPendingFeedback = (userId: string, conversationId: string, topic: string | null) =>
  prisma.feedbacks.create({
    data: {
      user_id: userId,
      conversation_id: conversationId,
      topic,
      status: "pending",
    },
  });

export const markFeedbackPending = (feedbackId: string) =>
  prisma.feedbacks.update({ where: { id: feedbackId }, data: { status: "pending" } });

export const markFeedbackFailed = (feedbackId: string) =>
  prisma.feedbacks.update({ where: { id: feedbackId }, data: { status: "failed" } });

// 생성 성공 시 결과를 채워 status=ready로 전환한다.
export const markFeedbackReady = (
  feedbackId: string,
  data: {
    kindnessScore: number;
    initiativeScore: number;
    empathyScore: number;
    questionLinkScore: number;
    metricsDetail: unknown;
    missionSummary: string[];
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
      metrics_detail: data.metricsDetail as Prisma.InputJsonValue,
      mission_summary: data.missionSummary as unknown as Prisma.InputJsonValue,
      saved_phrase: data.savedPhrase,
      status: "ready",
    },
  });

// GET /reports/weekly-compare용 — 특정 기간에 생성된(status=ready) 피드백의 지표 평균.
export const aggregateMetricAveragesInRange = (userId: string, from: Date, to: Date) =>
  prisma.feedbacks.aggregate({
    where: { user_id: userId, status: "ready", created_at: { gte: from, lt: to } },
    _avg: {
      kindness_score: true,
      initiative_score: true,
      empathy_score: true,
      question_link_score: true,
    },
  });
