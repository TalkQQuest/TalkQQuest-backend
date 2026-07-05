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