// modules/mission/services/mission.service.ts
import { PersonalityType } from "@prisma/client";
import { z } from "zod";
import * as missionRepository from "../repositories/mission.repository";
import { DuplicatedError } from "../../../shared/errors/common.error";
import {
  InvalidMissionDateError,
  MissionNotFoundError,
  MissionRefreshLimitExceededError,
  RecommendationLogNotFoundError,
  SaveNotFoundError,
} from "../errors/mission.error";
import {
  GetMissionsQueryDto,
  GetTodayMissionQueryDto,
  MissionListResponseDto,
  MissionListItemDto,
  MissionDetailResponseDto,
  MissionPrepResponseDto,
  MissionPrepItemDto,
  MissionSaveResponseDto,
  MissionUnsaveResponseDto,
  SaveRecommendedMissionResponseDto,
  TodayMissionResponseDto
} from "../dtos/mission.dto";
import {
  DIFFICULTY_TO_INT,
  DIFFICULTY_TO_LABEL,
  MISSION_DATE_TOLERANCE_DAYS,
  MISSION_REFRESH_LIMIT,
} from "../dtos/mission.constants";
import { daysBetween, toDateOnly, todayInKst } from "../../../shared/utils/date";
import { recommendMission } from "./recommendation.service";
import { generateStarters, pickRandomStarters } from "./prep.service";

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
    is_template: boolean;
    created_by_user_id: string | null;
  },
  isSaved: boolean,
  userId: string
): MissionListItemDto => ({
  id: mission.id,
  title: mission.title,
  category: mission.category,
  difficulty: DIFFICULTY_TO_LABEL[mission.difficulty],
  estimatedMinutes: mission.estimated_minutes,
  rewardXp: mission.reward_xp,
  isSaved,
  origin: mission.is_template ? "template" : "ai",
  isMine: !mission.is_template && mission.created_by_user_id === userId,
});

// 미션 목록 = 템플릿 미션 + 내가 받은 AI 미션 + 나와 같은 성향의 사용자가 실제로 수행한 AI 미션.
// 어떤 미션이 보이는지는 성향에 따라 달라지므로 목록/카운트 모두 같은 visibility로 조회한다.
export const getMissions = async (
  userId: string,
  query: GetMissionsQueryDto
): Promise<MissionListResponseDto> => {
  const page = query.page ?? DEFAULT_PAGE;
  const size = query.size ?? DEFAULT_SIZE;
  const difficultyInt = query.difficulty ? DIFFICULTY_TO_INT[query.difficulty] : undefined;

  const personalityType = await missionRepository.findUserPersonalityType(userId);
  const visibility = { userId, personalityType, origin: query.origin };

  const [missions, totalCount] = await Promise.all([
    missionRepository.findMissions({
      difficulty: difficultyInt,
      category: query.category,
      visibility,
      page,
      size,
    }),
    missionRepository.countMissions({
      difficulty: difficultyInt,
      category: query.category,
      visibility,
    }),
  ]);

  const savedRows = await missionRepository.findSavedMissionIds(userId, missions.map((m) => m.id));
  const savedIds = new Set(savedRows.map((r) => r.mission_id));

  let items = missions.map((m) => toListItemDto(m, savedIds.has(m.id), userId));
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

// 클라이언트가 보낸 날짜를 검증해 이 추천이 속할 "하루"를 정한다.
// 날짜를 클라이언트에서 받는 이유는 사용자 시간대마다 하루의 경계가 다르기 때문이다.
// 다만 그대로 믿으면 임의의 날짜를 보내 새로고침 제한(=LLM 호출 비용)을 무한히 우회할 수 있어,
// 서버(KST) 기준 오늘과 ±MISSION_DATE_TOLERANCE_DAYS 이내인지 확인한다.
const resolveMissionDate = (requested?: string): string => {
  const serverToday = todayInKst();
  if (!requested) return serverToday;

  const diff = daysBetween(requested, serverToday);
  if (Number.isNaN(diff) || Math.abs(diff) > MISSION_DATE_TOLERANCE_DAYS) {
    throw new InvalidMissionDateError();
  }
  return requested;
};

// 그날의 첫 추천은 새로고침으로 세지 않는다 — 로그 N건 = 새로고침 N-1회.
const usedRefreshCount = (logCount: number): number => Math.max(0, logCount - 1);

// llm/fallback 추천을 실제 Missions 행으로 만들고, 로그에 백링크해 중복 생성을 막는다.
// template 추천은 이미 실제 미션이므로 백링크만 남긴다.
// 추천 시점에 바로 저장하기 때문에 프런트는 추가 호출 없이 곧장 대화를 시작할 수 있고,
// 이 미션이 다른 사용자(같은 성향)의 목록에도 후보로 올라간다.
const materializeRecommendedMission = async (
  userId: string,
  recommended: {
    missionId: string | null;
    title: string;
    description: string;
    difficulty: number;
    estimatedMinutes: number;
    rewardXp: number;
    category: string;
  },
  personalityType: PersonalityType | null,
  recommendationLogId: string | null
): Promise<string> => {
  const missionId =
    recommended.missionId ??
    (
      await missionRepository.createMissionFromRecommendation({
        title: recommended.title,
        description: recommended.description,
        difficulty: recommended.difficulty,
        estimatedMinutes: recommended.estimatedMinutes,
        rewardXp: recommended.rewardXp,
        category: recommended.category,
        createdByUserId: userId,
        creatorPersonalityType: personalityType,
      })
    ).id;

  if (recommendationLogId) {
    await missionRepository.markRecommendationLogMissionCreated(recommendationLogId, missionId);
  }
  return missionId;
};

// 오늘의 미션.
//  - 오늘 추천이 이미 있으면 그대로 돌려준다 (LLM을 다시 부르지 않는다).
//  - 없으면 새로 뽑아 실제 Missions 행까지 만든다.
//  - refresh=true면 오늘 추천이 있어도 다시 뽑되, 하루 MISSION_REFRESH_LIMIT회로 제한한다.
// recommendMission은 온보딩 미완료 시 MissionProfileNotFoundError를 던지고, 그 외에는 항상
// 추천 1건(LLM/템플릿/폴백)을 반환하므로 여기서 not-found 처리는 불필요하다.
export const getTodayMission = async (
  userId: string,
  query: GetTodayMissionQueryDto = {}
): Promise<TodayMissionResponseDto> => {
  const date = resolveMissionDate(query.date);
  const dateOnly = toDateOnly(date);

  const [existingLog, logCount] = await Promise.all([
    missionRepository.findLatestRecommendationLogByDate(userId, dateOnly),
    missionRepository.countRecommendationLogsByDate(userId, dateOnly),
  ]);

  // 오늘 추천을 그대로 재사용하는 경로. 로그 JSON이 깨져 있으면 캐시를 포기하고 아래에서 새로 뽑는다.
  if (existingLog && !query.refresh) {
    const cached = persistedRecommendedMissionSchema.safeParse(existingLog.recommended_mission);
    if (cached.success) {
      const missionId = existingLog.created_mission_id ?? cached.data.missionId;
      return buildTodayMissionResponse({
        userId,
        recommended: cached.data,
        missionId,
        recommendationLogId: existingLog.id,
        date,
        refreshCount: usedRefreshCount(logCount),
        isNew: false,
      });
    }
  }

  if (query.refresh && usedRefreshCount(logCount) >= MISSION_REFRESH_LIMIT) {
    throw new MissionRefreshLimitExceededError();
  }

  const personalityType = await missionRepository.findUserPersonalityType(userId);
  const recommended = await recommendMission(userId, dateOnly);
  const missionId = await materializeRecommendedMission(
    userId,
    recommended,
    personalityType,
    recommended.recommendationLogId
  );

  return buildTodayMissionResponse({
    userId,
    recommended,
    missionId,
    recommendationLogId: recommended.recommendationLogId,
    date,
    // 방금 만든 로그 1건을 더한 기준으로 남은 횟수를 계산한다.
    refreshCount: usedRefreshCount(logCount + 1),
    isNew: true,
  });
};

const buildTodayMissionResponse = async (params: {
  userId: string;
  recommended: z.infer<typeof persistedRecommendedMissionSchema>;
  missionId: string | null;
  recommendationLogId: string | null;
  date: string;
  refreshCount: number;
  isNew: boolean;
}): Promise<TodayMissionResponseDto> => {
  const { recommended } = params;
  const isSaved = params.missionId
    ? !!(await missionRepository.findSavedMission(params.userId, params.missionId))
    : false;

  return {
    missionId: params.missionId,
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
    recommendationLogId: params.recommendationLogId,
    date: params.date,
    refreshCount: params.refreshCount,
    refreshLimit: MISSION_REFRESH_LIMIT,
    remainingRefreshes: Math.max(0, MISSION_REFRESH_LIMIT - params.refreshCount),
    isNew: params.isNew,
  };
};

// Recommendation_Logs.recommended_mission(Json)에서 필요한 필드만 검증해 뽑아낸다.
// 내부에서 recommendMission이 만든 값만 저장되지만, JSON 컬럼이라 타입이 보장되지 않으므로
// 방어적으로 파싱한다 — 형식이 깨져 있으면 애매한 런타임 에러 대신 명확한 404로 처리된다.
const persistedRecommendedMissionSchema = z.object({
  missionId: z.string().nullable(),
  title: z.string(),
  description: z.string(),
  difficulty: z.number(),
  estimatedMinutes: z.number(),
  rewardXp: z.number(),
  category: z.string(),
  // 오늘의 미션 캐시 응답에만 쓰는 필드. 이 기능 이전에 쌓인 로그에는 없을 수 있어 기본값을 둔다.
  reason: z.string().default(""),
  expectedEffect: z.string().default(""),
  source: z.enum(["template", "fallback", "llm"]).default("template"),
});

// 추천을 실제 Missions로 저장한다.
// getTodayMission이 추천 시점에 이미 저장하므로 보통은 필요 없지만, 저장 전에 만들어진 추천이나
// 저장이 중간에 실패한 경우를 위해 남겨 둔다. 같은 recommendationLogId로 재요청해도
// created_mission_id 백링크 덕분에 중복 생성되지 않는다(멱등).
export const saveRecommendedMission = async (
  userId: string,
  recommendationLogId: string
): Promise<SaveRecommendedMissionResponseDto> => {
  const log = await missionRepository.findRecommendationLogByIdAndUser(recommendationLogId, userId);
  if (!log) throw new RecommendationLogNotFoundError();

  if (log.created_mission_id) {
    return { missionId: log.created_mission_id };
  }

  const parsed = persistedRecommendedMissionSchema.safeParse(log.recommended_mission);
  if (!parsed.success) {
    throw new RecommendationLogNotFoundError("저장할 수 없는 추천 기록입니다.");
  }

  const personalityType = await missionRepository.findUserPersonalityType(userId);
  const missionId = await materializeRecommendedMission(
    userId,
    parsed.data,
    personalityType,
    recommendationLogId
  );
  return { missionId };
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

  // 아직 후보가 없는 미션(기존 미션 전부 + AI로 새로 생성된 미션)은 이 시점에 만들어 캐시한다.
  if (pool.length === 0) {
    const generated = await generateStarters(mission.title, mission.description);
    if (generated) {
      await missionRepository.createPrepItems(missionId, "starter", generated);
      pool = await missionRepository.findPrepItemsByType(missionId, "starter");
    }
  }

  // LLM이 실패하면 빈 배열이 나가고 앱이 기존처럼 자체 문구를 띄운다.
  // 여기서 일반 인사말을 지어내면 "모든 미션이 똑같다"는 원래 문제로 되돌아가므로 채우지 않는다.
  const picked = pickRandomStarters(pool.map((item) => item.content));
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