import { PersonalityType } from "@prisma/client";
import {
  DifficultyAdjustment,
  RecentMissionRecord,
  RecommendationCriteria,
  UserContext,
} from "../dtos/recommendation.dto";

// 2단계 — 규칙 기반 난이도 조정 / 회피 유형 필터.
// 여기 있는 함수는 전부 순수 함수(부수효과·I/O 없음)라 단위 테스트가 쉽습니다.
// 회피 패턴 판단 같은 민감한 로직은 AI에 맡기지 않고 서버가 결정론적으로 처리하고,
// 그 결과를 이후 LLM 프롬프트에 "힌트"로만 넘깁니다.

export const MIN_DIFFICULTY = 1; // 쉬움
export const MAX_DIFFICULTY = 3; // 어려움 (Missions.difficulty 스케일)

// 최근 몇 건까지 보고 난이도/회피를 판단할지.
const RECENT_WINDOW = 3;
// 이 횟수 이상 회피/실패가 쌓인 카테고리는 추천에서 제외.
const AVOIDANCE_EXCLUDE_THRESHOLD = 2;

const clampDifficulty = (value: number): number =>
  Math.min(MAX_DIFFICULTY, Math.max(MIN_DIFFICULTY, value));

// 수행 기록이 아직 없는 신규 사용자의 시작 난이도.
// 온보딩 성향을 반영해 내향형은 더 낮은 난이도에서 출발합니다.
export const seedDifficultyFromPersonality = (
  personality: PersonalityType | null
): number => {
  switch (personality) {
    case "introvert":
      return MIN_DIFFICULTY; // 1
    case "extrovert":
      return 2;
    case "ambivert":
    default:
      return 2;
  }
};

// 최근 기록을 근거로 기준 난이도를 조정.
// - 최근 3건 중 회피/실패가 2건 이상 → 한 단계 하향
// - 최근 3건이 모두 성공 → 한 단계 상향
// - 그 외 → 유지
export const adjustDifficulty = (
  recentMissions: RecentMissionRecord[],
  baseDifficulty: number
): DifficultyAdjustment => {
  const recent = recentMissions.slice(0, RECENT_WINDOW);

  const failOrAvoid = recent.filter(
    (m) => m.result === "failure" || m.result === "avoidance"
  ).length;
  const successCount = recent.filter((m) => m.result === "success").length;

  if (failOrAvoid >= 2) {
    return {
      baseDifficulty,
      adjustedDifficulty: clampDifficulty(baseDifficulty - 1),
      reason: "lowered_repeated_avoidance",
    };
  }

  if (recent.length >= RECENT_WINDOW && successCount === RECENT_WINDOW) {
    return {
      baseDifficulty,
      adjustedDifficulty: clampDifficulty(baseDifficulty + 1),
      reason: "raised_streak_success",
    };
  }

  return {
    baseDifficulty,
    adjustedDifficulty: clampDifficulty(baseDifficulty),
    reason: "kept",
  };
};

// 최근 창(window) 안에서 회피/실패가 임계치 이상 쌓인 카테고리를 수집.
// 반환된 카테고리는 추천 후보에서 제외합니다(반복 회피 유형 회피 → 대체 유형 유도).
export const collectAvoidedCategories = (
  recentMissions: RecentMissionRecord[]
): string[] => {
  const failCountByCategory = new Map<string, number>();

  for (const m of recentMissions.slice(0, RECENT_WINDOW)) {
    if (m.result === "failure" || m.result === "avoidance") {
      failCountByCategory.set(m.category, (failCountByCategory.get(m.category) ?? 0) + 1);
    }
  }

  return [...failCountByCategory.entries()]
    .filter(([, count]) => count >= AVOIDANCE_EXCLUDE_THRESHOLD)
    .map(([category]) => category);
};

// 1단계 컨텍스트 → 이후 단계(템플릿 조회 / LLM 프롬프트)로 넘길 최종 추천 기준.
export const buildRecommendationCriteria = (context: UserContext): RecommendationCriteria => {
  const difficultyAdjustment = adjustDifficulty(context.recentMissions, context.baseDifficulty);

  return {
    userId: context.userId,
    targetDifficulty: difficultyAdjustment.adjustedDifficulty,
    avoidedCategories: collectAvoidedCategories(context.recentMissions),
    preferredInterests: context.interests,
    personalityType: context.personalityType,
    isColdStart: context.isColdStart,
    difficultyAdjustment,
  };
};
