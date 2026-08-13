// modules/mission/services/mission.service.ts
import { PersonalityType, Prisma } from "@prisma/client";
import { z } from "zod";
import * as missionRepository from "../repositories/mission.repository";
import { DuplicatedError } from "../../../shared/errors/common.error";
import {
  InvalidMissionDateError,
  MissionNotFoundError,
  MissionRefreshLimitExceededError,
  MissionSetupDisabledCombinationError,
  RecommendationLogNotFoundError,
  SaveNotFoundError,
} from "../errors/mission.error";
import {
  CreateMissionSetupRequestDto,
  CreateMissionSetupResponseDto,
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
  SetupGuidelineDto,
  setupGuidelineSchema,
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
import { generateStarters, pickRandomStarters, STARTER_DISPLAY_COUNT } from "./prep.service";

const DEFAULT_PAGE = 1;
const DEFAULT_SIZE = 10;

// Missions.setup_guideline(Json)을 안전하게 파싱한다. LLM이 만든 값이라 형식이 깨질 수 있고,
// 이 컬럼 도입 이전 미션·템플릿 미션은 애초에 null이다 — 두 경우 모두 미션 조회 자체를
// 실패시키지 않고 setupGuideline: null로 응답한다(앱이 전체 활성+자체 기본값으로 처리).
const parseSetupGuideline = (raw: unknown): SetupGuidelineDto | null => {
  if (raw === null || raw === undefined) return null;
  const parsed = setupGuidelineSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
};

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
    setupGuideline: SetupGuidelineDto | null;
    preparationTip: string | null;
    caution: string | null;
  },
  personalityType: PersonalityType | null,
  recommendationLogId: string | null
): Promise<string> => {
  // template 추천은 이미 실제 미션이라 만들 것이 없다. 백링크만 남긴다.
  if (recommended.missionId) {
    if (recommendationLogId) {
      await missionRepository.markRecommendationLogMissionCreated(
        recommendationLogId,
        recommended.missionId
      );
    }
    return recommended.missionId;
  }

  const missionData = {
    title: recommended.title,
    description: recommended.description,
    difficulty: recommended.difficulty,
    estimatedMinutes: recommended.estimatedMinutes,
    rewardXp: recommended.rewardXp,
    category: recommended.category,
    setupGuideline: recommended.setupGuideline,
    preparationTip: recommended.preparationTip,
    caution: recommended.caution,
    createdByUserId: userId,
    creatorPersonalityType: personalityType,
  };

  // 로그가 있으면 그 로그를 기준으로 "정확히 하나"만 만든다(병렬 요청이 각자 미션을 만들고
  // 백링크를 덮어써 아무도 가리키지 않는 미션이 쌓이던 문제).
  if (recommendationLogId) {
    return missionRepository.createMissionForRecommendationLog(recommendationLogId, missionData);
  }
  return (await missionRepository.createMissionFromRecommendation(missionData)).id;
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
      let missionId = existingLog.created_mission_id ?? cached.data.missionId;
      // 아직 실제 Missions 행이 없는 캐시(이 기능 이전 로그, 또는 저장이 중간에 끊긴 경우)는
      // 여기서 만들어 백링크한다. 그냥 null로 내보내면 홈 카드가 하루 종일 비고
      // 대화도 시작할 수 없는데, 캐시는 살아 있어 그날 안에는 회복되지 않는다.
      if (!missionId) {
        const personalityType = await missionRepository.findUserPersonalityType(userId);
        missionId = await materializeRecommendedMission(
          userId,
          cached.data,
          personalityType,
          existingLog.id
        );
      }
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

    // #192 — 캐시(recommended_mission)가 손상돼 파싱에 실패한 경우(예: 슬롯은 예약됐는데 결과
    // 기록이 실패한 로그). 유저는 새로고침을 요청한 게 아니므로 이 복구를 새로고침 횟수로 세거나
    // 한도에 막혀서는 안 된다 — checkLimit: false로 예약해 한도와 무관하게 항상 새로 만든다.
    const personalityType = await missionRepository.findUserPersonalityType(userId);
    const { logId } = await reserveNextSlot(userId, dateOnly, logCount, false);
    const recommended = await recommendMission(userId, logId);
    const missionId = await materializeRecommendedMission(userId, recommended, personalityType, logId);
    return buildTodayMissionResponse({
      userId,
      recommended,
      missionId,
      recommendationLogId: logId,
      date,
      // 코드래빗 리뷰(PR #196): 복구용 슬롯 자체는 유저가 쓴 새로고침이 아니므로 refreshCount에
      // 반영하면 안 된다. slotIndex(복구 슬롯 포함) 대신 복구 전 로그 건수(logCount)를 그대로 쓴다.
      refreshCount: usedRefreshCount(logCount),
      isNew: true,
    });
  }

  // 여기부터는 (a) 오늘 추천이 아예 없거나(첫 조회) (b) refresh=true(명시적 재추천)인 경우다.
  // (b)만 한도를 체크해야 하지만, (a)는 슬롯 0이라 usedRefreshCount(1)이 항상 0이므로
  // 한도 체크를 같이 태워도 실질적으로 걸리지 않는다.
  const { logId: reservedLogId, slotIndex } = await reserveNextSlot(userId, dateOnly, logCount, true);

  const personalityType = await missionRepository.findUserPersonalityType(userId);
  const recommended = await recommendMission(userId, reservedLogId);
  const missionId = await materializeRecommendedMission(
    userId,
    recommended,
    personalityType,
    reservedLogId
  );

  return buildTodayMissionResponse({
    userId,
    recommended,
    missionId,
    recommendationLogId: reservedLogId,
    date,
    // 예약 전 건수가 아니라 실제로 확정된 순번을 기준으로 센다.
    refreshCount: usedRefreshCount(slotIndex + 1),
    isNew: true,
  });
};

// 그날의 다음 추천 슬롯을 선점하고 로그 id를 돌려준다.
// 한도 검사와 예약이 따로 놀면 병렬 요청이 같은 잔여 횟수를 읽고 함께 통과해 한도를 넘긴다.
// 그래서 (user, 날짜, 순번) unique 제약으로 승자를 하나만 남기고, 진 요청은 갱신된 순번으로
// 다시 시도한다. 재시도 횟수는 한도+1로 묶어 경합이 길어져도 유한하게 끝난다.
//
// checkLimit=false는 유저가 재추천을 요청한 게 아닌 상황(#192 — 손상된 캐시 복구)에 쓴다.
// 이 경우 슬롯 예약은 동일하게 하되(동시성 안전을 위해 필요), 한도를 넘겨도 429를 던지지 않는다
// — 자동 복구가 새로고침을 "쓴 것"으로 잡아먹으면 안 되기 때문이다.
const reserveNextSlot = async (
  userId: string,
  dateOnly: Date,
  knownLogCount: number,
  checkLimit: boolean
): Promise<{ logId: string; slotIndex: number }> => {
  let slotIndex = knownLogCount;

  for (let attempt = 0; attempt <= MISSION_REFRESH_LIMIT + 1; attempt += 1) {
    // 슬롯 0은 그날의 첫 추천이라 새로고침으로 세지 않는다.
    if (checkLimit && usedRefreshCount(slotIndex + 1) > MISSION_REFRESH_LIMIT) {
      throw new MissionRefreshLimitExceededError();
    }
    try {
      const reserved = await missionRepository.reserveRecommendationLogSlot(
        userId,
        dateOnly,
        slotIndex
      );
      // 확정된 순번을 함께 돌려준다. 경합에 지면 처음 계산한 값보다 커지므로, 호출부가
      // 예약 전 건수로 남은 횟수를 계산하면 실제보다 적게 안내하게 된다.
      return { logId: reserved.id, slotIndex };
    } catch (error) {
      // P2002 = unique 위반. 동시 요청이 이 순번을 먼저 가져갔다는 뜻이므로 다음 순번으로 넘어간다.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
        throw error;
      }
      slotIndex = await missionRepository.countRecommendationLogsByDate(userId, dateOnly);
    }
  }

  // 한도 안에서 계속 경합에 진 경우. 재시도로 풀릴 상태이므로 한도 초과와 같게 안내한다.
  // checkLimit=false에서 여기까지 온 건 동시성 폭주뿐이라(자동 복구 자체는 한도를 안 봄),
  // 429가 아니라 일반 오류로 표면화한다.
  if (checkLimit) {
    throw new MissionRefreshLimitExceededError();
  }
  throw new Error("오늘의 미션 슬롯 예약에 반복적으로 실패했습니다.");
};

const buildTodayMissionResponse = async (params: {
  userId: string;
  recommended: z.infer<typeof persistedRecommendedMissionSchema>;
  missionId: string;
  recommendationLogId: string;
  date: string;
  refreshCount: number;
  isNew: boolean;
}): Promise<TodayMissionResponseDto> => {
  const { recommended } = params;
  const [saved, missionRow] = await Promise.all([
    missionRepository.findSavedMission(params.userId, params.missionId),
    // 추천 결과는 Recommendation_Logs 캐시(JSON)에서 오므로 setup_guideline은 여기서 따로 읽는다.
    missionRepository.findMissionSetupGuideline(params.missionId),
  ]);

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
    isSaved: !!saved,
    recommendationLogId: params.recommendationLogId,
    date: params.date,
    refreshCount: params.refreshCount,
    refreshLimit: MISSION_REFRESH_LIMIT,
    remainingRefreshes: Math.max(0, MISSION_REFRESH_LIMIT - params.refreshCount),
    isNew: params.isNew,
    setupGuideline: parseSetupGuideline(missionRow?.setup_guideline),
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
  // 이 필드 도입 전 추천 로그와 템플릿 추천은 준비 팁/주의사항이 없다(#194).
  preparationTip: z.string().nullable().default(null),
  caution: z.string().nullable().default(null),
  // 이 필드 도입 전 추천 로그와 템플릿 추천은 가이드라인이 없다.
  setupGuideline: setupGuidelineSchema.nullable().default(null),
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
  const personalityType = await missionRepository.findUserPersonalityType(userId);
  const mission = await missionRepository.findVisibleMissionById(missionId, {
    userId,
    personalityType,
  });
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
    setupGuideline: parseSetupGuideline(mission.setup_guideline),
  };
};

// POST /missions/{missionId}/setups — #152.
// Mission_Setups는 "대화 1회짜리 개인 설정"이고 Missions.setup_guideline은 "미션 1개당 1벌,
// 여러 사용자가 공유하는 가이드라인"이다(#148-150 계층 원칙). 여기서는 가이드라인을 읽기만
// 하고 절대 갱신하지 않는다 — 그래야 같은 미션이라도 사용자마다 다른 환경/관계로 대화할 수
// 있고, 한 사용자의 선택이 다른 사용자가 보는 가이드라인에 새지 않는다.
export const createMissionSetup = async (
  userId: string,
  missionId: string,
  body: CreateMissionSetupRequestDto
): Promise<CreateMissionSetupResponseDto> => {
  const personalityType = await missionRepository.findUserPersonalityType(userId);
  const mission = await missionRepository.findVisibleMissionById(missionId, {
    userId,
    personalityType,
  });
  if (!mission) throw new MissionNotFoundError();

  const guideline = parseSetupGuideline(mission.setup_guideline);
  // 가이드라인이 없으면(구버전 미션·생성 실패) 제약할 근거가 없으므로 전체 축을 허용한다.
  if (guideline) {
    const disabledHit =
      guideline.disabled.environment.includes(body.environment) ||
      guideline.disabled.partnerRole.includes(body.partnerRole) ||
      guideline.disabled.partnerGender.includes(body.partnerGender) ||
      guideline.disabled.partnerAgeGroup.includes(body.partnerAgeGroup) ||
      guideline.disabled.intimacyLevel.includes(body.intimacyLevel) ||
      guideline.disabled.formalityLevel.includes(body.formalityLevel);
    if (disabledHit) throw new MissionSetupDisabledCombinationError();
  }

  const created = await missionRepository.createMissionSetup(userId, missionId, body);
  return { missionSetupId: created.id, createdAt: created.created_at.toISOString() };
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
// 목록과 같은 공개 범위를 적용한다. id만으로 찾으면 범위 밖 미션의 준비 문장을 읽을 수 있고,
// 아직 후보가 없는 미션이면 LLM 생성까지 유발한다(호출자가 비용을 발생시킬 수 있다).
export const getMissionPrep = async (
  userId: string,
  missionId: string
): Promise<MissionPrepResponseDto> => {
  const personalityType = await missionRepository.findUserPersonalityType(userId);
  const mission = await missionRepository.findVisibleMissionById(missionId, {
    userId,
    personalityType,
  });
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
