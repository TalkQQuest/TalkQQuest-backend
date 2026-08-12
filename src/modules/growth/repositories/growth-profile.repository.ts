// modules/growth/repositories/growth-profile.repository.ts
import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../../../config/database";

type Client = PrismaClient | Prisma.TransactionClient;

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
  limit: number,
  client: Client = prisma
) =>
  client.feedbacks.findMany({
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
export const findRecentReadyFeedbacks = (userId: string, limit: number, client: Client = prisma) =>
  client.feedbacks.findMany({
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

// unknown 값을 Json? 컬럼에 쓸 입력으로 변환한다.
// 일반 JS null을 그대로 넘기면 Prisma가 "SQL NULL을 원하는지 JSON 리터럴 null을 원하는지"를
// 구분하지 못해 런타임에 거부한다. 여기서는 컬럼을 비우는 의미이므로 Prisma.DbNull을 쓴다
// (mission.repository.ts의 setup_guideline과 동일한 규칙).
const toJsonInput = (value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull =>
  value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);

const toUpdatePayload = (data: GrowthProfileUpsertData) => ({
  summary: data.summary,
  strengths: toJsonInput(data.strengths),
  improvements: toJsonInput(data.improvements),
  struggle_situations: toJsonInput(data.struggleSituations),
  metric_averages: toJsonInput(data.metricAverages),
  suggested_difficulty: data.suggestedDifficulty,
  reflected_feedback_count: data.reflectedFeedbackCount,
  last_feedback_id: data.lastFeedbackId,
  last_reflected_at: data.lastReflectedAt,
});

// 사용자당 1행을 잠그고 갱신 콜백을 실행한다. 갱신 트리거(refreshGrowthProfile)가
// fire-and-forget이라 같은 사용자의 두 피드백이 거의 동시에 ready가 되면 두 실행이 겹칠 수
// 있는데, "커서를 읽고 → 새 커서를 계산해 쓴다"는 read-modify-write라 원자적으로 묶지 않으면
// 나중에 커밋한 쪽이 먼저 커밋한 쪽의 반영 건수·커서를 덮어써 잃어버린다(lost update).
//
// 행이 없으면 먼저 빈 행을 만들어 잠글 대상을 확보한다. 두 트랜잭션이 동시에 여기 도달해도
// user_id unique 제약이 한쪽만 통과시키고 나머지는 조용히 건너뛰므로(skipDuplicates),
// 어느 쪽이 이겼는지는 중요하지 않다 — 바로 다음 FOR UPDATE가 그 이후의 순서를 보장한다.
//
// REPEATABLE READ에서 일반 조회는 트랜잭션 시작 시점 스냅샷을 보므로, 잠금 없는 조회로는
// 동시 갱신 중 먼저 커밋된 쪽의 결과가 안 보일 수 있다(mission.repository.ts의 추천 로그
// 잠금 읽기와 같은 이유) — 그래서 findUnique가 아니라 잠금 읽기로 시작한다.
export const withGrowthProfileLock = <T>(
  userId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> =>
  prisma.$transaction(async (tx) => {
    await tx.user_Growth_Profiles.createMany({
      data: [{ user_id: userId }],
      skipDuplicates: true,
    });
    await tx.$queryRaw`SELECT id FROM User_Growth_Profiles WHERE user_id = ${userId} FOR UPDATE`;

    return fn(tx);
  });

export const findGrowthProfileTx = (tx: Prisma.TransactionClient, userId: string) =>
  tx.user_Growth_Profiles.findUnique({ where: { user_id: userId } });

export const saveGrowthProfile = (
  tx: Prisma.TransactionClient,
  userId: string,
  data: GrowthProfileUpsertData
) =>
  tx.user_Growth_Profiles.update({
    where: { user_id: userId },
    data: toUpdatePayload(data),
  });
