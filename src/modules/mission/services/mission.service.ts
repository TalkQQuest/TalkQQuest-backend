// modules/mission/services/mission.service.ts
import * as missionRepository from "../repositories/mission.repository";
import { DuplicatedError } from "../../../shared/errors/common.error";
import { MissionNotFoundError, SaveNotFoundError } from "../errors/mission.error";
import {
  GetMissionsQueryDto,
  MissionListResponseDto,
  MissionListItemDto,
  MissionDetailResponseDto,
  MissionPrepResponseDto,
  MissionPrepItemDto,
  MissionSaveResponseDto,
  MissionUnsaveResponseDto,
  TodayMissionResponseDto
} from "../dtos/mission.dto";
import { DIFFICULTY_TO_INT, DIFFICULTY_TO_LABEL } from "../dtos/mission.constants";
import { recommendMission } from "./recommendation.service";

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

// AI 미션 추천(1→2→3→4단계)의 결과를 오늘의 미션 응답으로 매핑한다.
// recommendMission은 온보딩 미완료 시 MissionProfileNotFoundError를 던지고,
// 그 외에는 항상 추천 1건(LLM/템플릿/폴백)을 반환하므로 여기서 not-found 처리는 불필요하다.
export const getTodayMission = async (userId: string): Promise<TodayMissionResponseDto> => {
  const recommended = await recommendMission(userId);

  // 템플릿 추천(missionId 존재)만 저장 여부를 조회할 수 있다. LLM/폴백 생성은 미저장이라 false.
  const isSaved = recommended.missionId
    ? !!(await missionRepository.findSavedMission(userId, recommended.missionId))
    : false;

  return {
    missionId: recommended.missionId,
    title: recommended.title,
    category: recommended.category,
    difficulty: DIFFICULTY_TO_LABEL[recommended.difficulty],
    estimatedMinutes: recommended.estimatedMinutes,
    rewardXp: recommended.rewardXp,
    description: recommended.description,
    reason: recommended.reason,
    expectedEffect: recommended.expectedEffect,
    source: recommended.source,
    isSaved,
  };
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

export const saveMission = async (
  userId: string,
  missionId: string
): Promise<MissionSaveResponseDto> => {
  const mission = await missionRepository.findMissionById(missionId);
  if (!mission) throw new MissionNotFoundError();

  const existing = await missionRepository.findSavedMission(userId, missionId);
  if (existing) throw new DuplicatedError("이미 저장된 미션입니다.");

  const saved = await missionRepository.createMissionSave(userId, missionId);
  return { missionId, isSaved: true, savedAt: saved.created_at.toISOString() };
};

export const unsaveMission = async (
  userId: string,
  missionId: string
): Promise<MissionUnsaveResponseDto> => {
  const existing = await missionRepository.findSavedMission(userId, missionId);
  if (!existing) throw new SaveNotFoundError();

  await missionRepository.deleteMissionSave(userId, missionId);
  return { missionId, isSaved: false };
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