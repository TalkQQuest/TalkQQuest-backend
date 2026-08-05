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
import { generateStarters, pickRandomStarters, STARTER_DISPLAY_COUNT } from "./prep.service";

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

// GET /missions/{missionId}/prep — "바로 쓰는 첫 마디".
// 미션별 후보를 한 번 생성해 캐시하고, 호출마다 그중 일부만 무작위로 돌려준다.
// 앱의 새로고침 버튼이 같은 API를 다시 부르는 구조라 이것만으로 매번 다른 문장이 나온다.
export const getMissionPrep = async (missionId: string): Promise<MissionPrepResponseDto> => {
  const mission = await missionRepository.findMissionById(missionId);
  if (!mission) throw new MissionNotFoundError();

  let pool = await missionRepository.findPrepItemsByType(missionId, "starter");

  // 후보가 없는 미션(신규·AI 생성)뿐 아니라, 표시 개수를 못 채우는 캐시도 다시 만든다.
  // 개수 미달을 허용하던 시절에 1~2개만 저장된 미션이 남아 있는데, 그대로 두면
  // 재생성 조건에 걸리지 않아 그 미션은 계속 3개 미만으로 노출된다.
  if (pool.length < STARTER_DISPLAY_COUNT) {
    const generated = await generateStarters(mission.title, mission.description);
    if (generated) {
      // order_index가 겹치면 unique 제약에 걸리므로 남은 부분 캐시를 먼저 비운다.
      await missionRepository.deletePrepItemsByType(missionId, "starter");
      await missionRepository.createPrepItems(missionId, "starter", generated);
      pool = await missionRepository.findPrepItemsByType(missionId, "starter");
    }
  }

  // LLM이 실패하면 빈 배열이 나가고 앱이 기존처럼 자체 문구를 띄운다.
  // 여기서 일반 인사말을 지어내면 "모든 미션이 똑같다"는 원래 문제로 되돌아가므로 채우지 않는다.
  // 재생성 후에도 개수를 못 채우면 부분 노출 대신 폴백으로 보낸다.
  const picked =
    pool.length >= STARTER_DISPLAY_COUNT
      ? pickRandomStarters(pool.map((item) => item.content))
      : [];
  const byContent = new Map(pool.map((item) => [item.content, item]));

  return {
    missionId,
    totalCount: picked.length,
    items: picked.map((content, index) => {
      const item = byContent.get(content)!;
      return {
        id: item.id,
        type: item.type as MissionPrepItemDto["type"],
        content,
        // 노출 순서는 매번 달라지므로 캐시된 order_index가 아니라 이번 응답 기준으로 매긴다.
        orderIndex: index,
      };
    }),
  };
};