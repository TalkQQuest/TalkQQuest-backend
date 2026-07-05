// modules/mission/services/mission.service.ts
import * as missionRepository from "../repositories/mission.repository";
import { MissionNotFoundError } from "../errors/mission.error";
import {
  GetMissionsQueryDto,
  MissionListResponseDto,
  MissionListItemDto,
  MissionDetailResponseDto,
  MissionPrepResponseDto,
  MissionPrepItemDto,
} from "../dtos/mission.dto";
import { DIFFICULTY_TO_INT, DIFFICULTY_TO_LABEL } from "../dtos/mission.constants";

const DEFAULT_PAGE = 1;
const DEFAULT_SIZE = 10;

const toListItemDto = (
  mission: {
    id: string;
    title: string;
    category: string;
    difficulty: number;
    estimated_minutes: number;
    reward_xp: number;
  },
  isSaved: boolean
): MissionListItemDto => ({
  id: mission.id,
  title: mission.title,
  category: mission.category,
  difficulty: DIFFICULTY_TO_LABEL[mission.difficulty],
  estimatedMinutes: mission.estimated_minutes,
  rewardXp: mission.reward_xp,
  isSaved,
});

export const getMissions = async (
  userId: string,
  query: GetMissionsQueryDto
): Promise<MissionListResponseDto> => {
  const page = query.page ?? DEFAULT_PAGE;
  const size = query.size ?? DEFAULT_SIZE;
  const difficultyInt = query.difficulty ? DIFFICULTY_TO_INT[query.difficulty] : undefined;

  const [missions, totalCount] = await Promise.all([
    missionRepository.findMissions({ difficulty: difficultyInt, category: query.category, page, size }),
    missionRepository.countMissions({ difficulty: difficultyInt, category: query.category }),
  ]);

  const savedRows = await missionRepository.findSavedMissionIds(userId, missions.map((m) => m.id));
  const savedIds = new Set(savedRows.map((r) => r.mission_id));

  let items = missions.map((m) => toListItemDto(m, savedIds.has(m.id)));
  if (query.saved !== undefined) {
    items = items.filter((item) => item.isSaved === query.saved);
  }

  return {
    missions: items,
    pageInfo: {
      currentPage: page,
      totalPages: Math.max(1, Math.ceil(totalCount / size)),
      totalCount,
    },
  };
};

export const getTodayMission = async (userId: string): Promise<MissionListItemDto> => {
  const mission = await missionRepository.findTodayMission();
  if (!mission) throw new MissionNotFoundError("추천 가능한 미션이 없습니다.");

  const saved = await missionRepository.findSavedMission(userId, mission.id);
  return toListItemDto(mission, !!saved);
};

export const getMissionDetail = async (
  userId: string,
  missionId: string
): Promise<MissionDetailResponseDto> => {
  const mission = await missionRepository.findMissionById(missionId);
  if (!mission) throw new MissionNotFoundError();

  const saved = await missionRepository.findSavedMission(userId, missionId);

  return {
    id: mission.id,
    title: mission.title,
    category: mission.category,
    difficulty: DIFFICULTY_TO_LABEL[mission.difficulty],
    estimatedMinutes: mission.estimated_minutes,
    rewardXp: mission.reward_xp,
    description: mission.description,
    preparationTip: mission.preparation_tip,
    caution: mission.caution,
    isSaved: !!saved,
  };
};

export const saveMission = async (userId: string, missionId: string): Promise<void> => {
  const mission = await missionRepository.findMissionById(missionId);
  if (!mission) throw new MissionNotFoundError();

  const existing = await missionRepository.findSavedMission(userId, missionId);
  if (existing) return; // 멱등 처리

  await missionRepository.createMissionSave(userId, missionId);
};

export const unsaveMission = async (userId: string, missionId: string): Promise<void> => {
  const existing = await missionRepository.findSavedMission(userId, missionId);
  if (!existing) return; // 멱등 처리

  await missionRepository.deleteMissionSave(userId, missionId);
};

export const getMissionPrep = async (missionId: string): Promise<MissionPrepResponseDto> => {
  const mission = await missionRepository.findMissionById(missionId);
  if (!mission) throw new MissionNotFoundError();

  const prepItems = await missionRepository.findPrepItems(missionId);

  return {
    missionId,
    totalCount: prepItems.length,
    items: prepItems.map((p) => ({
      id: p.id,
      type: p.type as MissionPrepItemDto["type"],
      content: p.content,
      orderIndex: p.order_index,
    })),
  };
};