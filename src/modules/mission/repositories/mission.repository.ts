// modules/mission/repositories/mission.repository.ts
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

// TODO: 오늘의 추천 미션 로직 미확정 — 우선 최신 미션 1건으로 대체
export const findTodayMission = () =>
  prisma.missions.findFirst({ orderBy: { created_at: "desc" } });

export const findSavedMissionIds = (userId: string, missionIds: string[]) =>
  prisma.mission_Saves.findMany({
    where: { user_id: userId, mission_id: { in: missionIds } },
    select: { mission_id: true },
  });

export const findSavedMission = (userId: string, missionId: string) =>
  prisma.mission_Saves.findUnique({
    where: { user_id_mission_id: { user_id: userId, mission_id: missionId } },
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