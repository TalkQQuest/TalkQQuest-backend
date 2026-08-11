// modules/growth/repositories/growth-profile.repository.ts
import { Prisma } from "@prisma/client";
import { prisma } from "../../../config/database";

// 성장 프로필 1행 조회. 없으면 null (아직 피드백이 없거나 갱신이 한 번도 안 돈 사용자).
export const findGrowthProfile = (userId: string) =>
  prisma.user_Growth_Profiles.findUnique({ where: { user_id: userId } });

// 커서 이후의 ready 피드백을 오래된 순으로 읽는다.
//
// 커서가 (ready_at, id)인 이유 — 피드백은 pending으로 먼저 생성되고 나중에 ready가 되므로
// 생성 순서와 ready 순서가 다르다. created_at을 커서로 쓰면, 먼저 생성됐지만 아직 pending인
// A를 건너뛴 채 늦게 생성된 B가 커서를 밀어버리고, A가 뒤늦게 ready가 돼도 생성 시각이
// 커서보다 앞이라 영영 집계에서 빠진다.
//
// 커서가 null이면(첫 갱신) 조건을 아예 걸지 않는다. `(ready_at, id) > (NULL, NULL)`은
// false가 아니라 NULL이라 한 건도 걸리지 않기 때문이다.
export const findReadyFeedbacksAfterCursor = (
  userId: string,
  cursor: { readyAt: Date; feedbackId: string } | null,
  limit: number
) =>
  prisma.feedbacks.findMany({
    where: {
      user_id: userId,
      status: "ready",
      ready_at: { not: null },
      ...(cursor
        ? {
            OR: [
              { ready_at: { gt: cursor.readyAt } },
              { ready_at: cursor.readyAt, id: { gt: cursor.feedbackId } },
            ],
          }
        : {}),
    },
    // 상황 축(Mission_Setups)과 카테고리(Missions)는 대화를 거쳐야 닿는다.
    // 집계 기점을 Mission_Records가 아니라 Feedbacks로 잡는 이유 —
    // Feedbacks.conversation_id는 필수(unique)라 모든 피드백이 반드시 대화에 닿지만
    // Mission_Records.conversation_id는 nullable이라, 그쪽을 기점으로 잡으면
    // 완료 기록이 없는 대화의 피드백이 통째로 빠진다.
    include: {
      conversation: {
        select: {
          mission: { select: { category: true, difficulty: true } },
          mission_setup: { select: { environment: true, partner_role: true } },
        },
      },
    },
    orderBy: [{ ready_at: "asc" }, { id: "asc" }],
    take: limit,
  });

// 요약 입력으로 쓸 최근 ready 피드백(최신순). 커서와 무관하게 항상 최근 창을 다시 읽는다 —
// 요약은 누적이 아니라 "지금 시점의 최근 N건"을 다시 쓰는 것이라 증분분만으로는 만들 수 없다.
export const findRecentReadyFeedbacks = (userId: string, limit: number) =>
  prisma.feedbacks.findMany({
    where: { user_id: userId, status: "ready", ready_at: { not: null } },
    include: {
      conversation: {
        select: {
          mission: { select: { category: true, difficulty: true } },
          mission_setup: { select: { environment: true, partner_role: true } },
        },
      },
    },
    orderBy: [{ ready_at: "desc" }, { id: "desc" }],
    take: limit,
  });

export interface GrowthProfileUpsertData {
  summary: string | null;
  strengths: unknown;
  improvements: unknown;
  struggleSituations: unknown;
  metricAverages: unknown;
  suggestedDifficulty: number | null;
  reflectedFeedbackCount: number;
  lastFeedbackId: string | null;
  lastReflectedAt: Date | null;
}

// 사용자당 1행이라 upsert로 처리한다. 동시에 두 피드백이 ready가 되어도
// user_id unique 제약이 하나만 통과시키고 나머지는 update로 흐른다.
export const upsertGrowthProfile = (userId: string, data: GrowthProfileUpsertData) => {
  const payload = {
    summary: data.summary,
    strengths: data.strengths as Prisma.InputJsonValue,
    improvements: data.improvements as Prisma.InputJsonValue,
    struggle_situations: data.struggleSituations as Prisma.InputJsonValue,
    metric_averages: data.metricAverages as Prisma.InputJsonValue,
    suggested_difficulty: data.suggestedDifficulty,
    reflected_feedback_count: data.reflectedFeedbackCount,
    last_feedback_id: data.lastFeedbackId,
    last_reflected_at: data.lastReflectedAt,
  };

  return prisma.user_Growth_Profiles.upsert({
    where: { user_id: userId },
    create: { user_id: userId, ...payload },
    update: payload,
  });
};
