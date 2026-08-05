// modules/mission/repositories/mission.repository.ts
import { Prisma, PrepItemType, RecommendationSource } from "@prisma/client";
import { prisma } from "../../../config/database";

export const findMissions = (params: {
  difficulty?: number;
  category?: string;
  page: number;
  size: number;
}) =>
  prisma.missions.findMany({
    where: {
      ...(params.difficulty !== undefined && { difficulty: params.difficulty }),
      ...(params.category && { category: params.category }),
    },
    orderBy: { created_at: "desc" },
    skip: (params.page - 1) * params.size,
    take: params.size,
  });

export const countMissions = (params: { difficulty?: number; category?: string }) =>
  prisma.missions.count({
    where: {
      ...(params.difficulty !== undefined && { difficulty: params.difficulty }),
      ...(params.category && { category: params.category }),
    },
  });

export const findMissionById = (missionId: string) =>
  prisma.missions.findUnique({ where: { id: missionId } });

export const findSavedMissionIds = (userId: string, missionIds: string[]) =>
  prisma.mission_Saves.findMany({
    where: { user_id: userId, mission_id: { in: missionIds } },
    select: { mission_id: true },
  });

// 아카이브 요약(missionRecordCount)이 "완료 기록 수"에서 "북마크한 미션 수" 기준으로 바뀌면서 필요해짐 (#86).
export const countSavedMissions = (userId: string) =>
  prisma.mission_Saves.count({ where: { user_id: userId } });

export const findSavedMission = (userId: string, missionId: string) =>
  prisma.mission_Saves.findUnique({
    where: { user_id_mission_id: { user_id: userId, mission_id: missionId } },
  });

// 아카이브 저장 목록 조회용
export const findSavedMissions = (params: {
  userId: string;
  startDate?: Date;
  endDate?: Date;
  sort: "asc" | "desc";
}) =>
  prisma.mission_Saves.findMany({
    where: {
      user_id: params.userId,
      ...(params.startDate || params.endDate
        ? {
            created_at: {
              ...(params.startDate && { gte: params.startDate }),
              ...(params.endDate && { lte: params.endDate }),
            },
          }
        : {}),
    },
    include: {
      mission: {
        select: {
          id: true,
          title: true,
          category: true,
          difficulty: true,
          estimated_minutes: true,
          reward_xp: true,
        },
      },
    },
    orderBy: {
      created_at: params.sort,
    },
  });

// 유저의 최신 mission_Record 조회 (완료 여부 판단용)
export const findLatestMissionRecordsByMissionIds = (userId: string, missionIds: string[]) =>
  prisma.mission_Records.findMany({
    where: { user_id: userId, mission_id: { in: missionIds } },
    orderBy: { created_at: "desc" },
    select: { id: true, mission_id: true, status: true },
  });

export const createMissionSave = (userId: string, missionId: string) =>
  prisma.mission_Saves.create({ data: { user_id: userId, mission_id: missionId } });

export const deleteMissionSave = (userId: string, missionId: string) =>
  prisma.mission_Saves.delete({
    where: { user_id_mission_id: { user_id: userId, mission_id: missionId } },
  });

export const findPrepItems = (missionId: string) =>
  prisma.mission_Prep_Items.findMany({
    where: { mission_id: missionId },
    orderBy: { order_index: "asc" },
  });

export const findPrepItemsByType = (missionId: string, type: PrepItemType) =>
  prisma.mission_Prep_Items.findMany({
    where: { mission_id: missionId, type },
    orderBy: { order_index: "asc" },
  });

// 표시 개수를 못 채우는 부분 캐시를 다시 만들 때 쓴다.
// order_index가 겹치면 unique 제약에 걸리므로 새로 넣기 전에 비워야 한다.
export const deletePrepItemsByType = (missionId: string, type: PrepItemType) =>
  prisma.mission_Prep_Items.deleteMany({ where: { mission_id: missionId, type } });

// 생성한 첫 마디 후보를 캐시해 둔다. 미션당 1회만 만들고 이후에는 재사용한다.
export const createPrepItems = (
  missionId: string,
  type: PrepItemType,
  contents: string[]
) =>
  prisma.mission_Prep_Items.createMany({
    data: contents.map((content, index) => ({
      mission_id: missionId,
      type,
      content,
      order_index: index,
    })),
    // 동시 요청이 모두 빈 캐시를 읽고 같은 미션에 후보를 두 벌 넣는 것을 막는다.
    // (mission_id, type, order_index) unique 제약과 짝이다 — 늦은 쪽은 조용히 버려지고,
    // 호출부가 곧바로 다시 조회하므로 먼저 들어간 한 벌을 그대로 쓴다.
    skipDuplicates: true,
  });

// ── 대화 플레이북 (Mission_Playbooks) ──
// 임베딩 때문에 1MB를 넘길 수 있어 Missions와 분리된 테이블이다. 여기서만 다룬다.

export const findPlaybookByMissionId = (missionId: string) =>
  prisma.mission_Playbooks.findUnique({
    where: { mission_id: missionId },
    select: { data: true, updated_at: true },
  });

// 같은 미션으로 동시에 대화를 시작하면 둘 다 생성할 수 있어 upsert로 받는다.
export const upsertPlaybook = (missionId: string, data: unknown) =>
  prisma.mission_Playbooks.upsert({
    where: { mission_id: missionId },
    create: { mission_id: missionId, data: data as never },
    update: { data: data as never },
  });

// 삭제해도 다음 대화 시작 시 자동 재생성된다(ensureMissionPlaybook).
export const deletePlaybook = (missionId: string) =>
  prisma.mission_Playbooks.deleteMany({ where: { mission_id: missionId } });

// ── AI 미션 추천 파이프라인용 조회 (recommendation/difficulty/template.service) ──

export const findUserProfileByUserId = (userId: string) =>
  prisma.user_Profiles.findUnique({ where: { user_id: userId } });

export const findActiveGoalsByUserId = (userId: string) =>
  prisma.goals.findMany({
    where: { user_id: userId, is_active: true },
    orderBy: { created_at: "desc" },
  });

// 최근 수행 기록 N건을 미션 메타(제목/카테고리/난이도)와 조인해 최신순으로 조회.
// 난이도 조정·회피 유형 판단은 최근 몇 건만 보므로 take로 제한합니다.
export const findRecentMissionRecords = (userId: string, limit: number) =>
  prisma.mission_Records.findMany({
    where: { user_id: userId },
    include: {
      mission: { select: { id: true, title: true, category: true, difficulty: true } },
    },
    orderBy: { created_at: "desc" },
    take: limit,
  });

// 3단계 템플릿 폴백용. is_template=true 미션 중 회피 카테고리만 DB에서 걸러 가져오고,
// 난이도 근접·관심사 매칭 같은 랭킹은 서비스(순수 함수)에서 처리합니다.
export const findTemplateMissionsExcluding = (excludedCategories: string[]) =>
  prisma.missions.findMany({
    where: {
      is_template: true,
      ...(excludedCategories.length > 0 ? { category: { notIn: excludedCategories } } : {}),
    },
    orderBy: { created_at: "asc" },
  });

// 추천 호출 1건을 Recommendation_Logs에 기록 (품질 개선·오류 추적용).
// Json 컬럼 중 null이 될 수 있는 prompt_input만 DbNull로 변환한다.
export const createRecommendationLog = (data: {
  userId: string;
  source: RecommendationSource;
  llmModel: string | null;
  targetDifficulty: number | null;
  avoidedCategories: string[];
  promptInput: unknown | null;
  rawResponse: string | null;
  parseSuccess: boolean;
  recommendedMission: unknown;
  fallbackReason: string | null;
}) =>
  prisma.recommendation_Logs.create({
    data: {
      user_id: data.userId,
      source: data.source,
      llm_model: data.llmModel,
      target_difficulty: data.targetDifficulty,
      avoided_categories: data.avoidedCategories as unknown as Prisma.InputJsonValue,
      prompt_input:
        data.promptInput === null ? Prisma.DbNull : (data.promptInput as Prisma.InputJsonValue),
      raw_response: data.rawResponse,
      parse_success: data.parseSuccess,
      recommended_mission: data.recommendedMission as Prisma.InputJsonValue,
      fallback_reason: data.fallbackReason,
    },
  });
