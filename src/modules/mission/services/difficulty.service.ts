import { PersonalityType } from "@prisma/client";
import { DifficultyDecision, RecommendationCriteria, UserContext } from "../dtos/recommendation.dto";

// 2단계 — 난이도 결정.
// 여기 있는 함수는 전부 순수 함수(부수효과·I/O 없음)라 단위 테스트가 쉽습니다.
//
// #150 이전에는 Mission_Records.result(success/failure/avoidance)를 근거로
// "최근 3건 중 회피·실패 2건 이상이면 하향", "3건 모두 성공이면 상향" 규칙을 썼습니다.
// 그런데 미션-대화에 실패라는 개념이 없어 result에는 항상 success가 들어옵니다.
// 그래서 상향 조건이 매번 충족돼 3회 완료 시점부터 난이도가 3에 고정되고, 하향 규칙은
// 한 번도 발동하지 않았습니다. 규칙이 안 쓰인 게 아니라 잘못 작동하고 있었습니다.
//
// 이제 실제 신호인 **피드백 지표**에서 뽑은 성장 프로필의 제안 난이도를 쓰되,
// 아래 클램프로 한 번에 튀는 것을 막습니다.

export const MIN_DIFFICULTY = 1; // 쉬움
export const MAX_DIFFICULTY = 3; // 어려움 (Missions.difficulty 스케일)

// 성장 프로필의 제안 난이도가 최근 미션 난이도에서 한 번에 벗어날 수 있는 폭.
// 요약은 LLM 파생 데이터라 한 번 어긋나면 그대로 굳는데, 클램프가 없으면 방금 걷어낸 문제
// (난이도가 한쪽 끝에 고정)를 다른 경로로 되풀이하게 됩니다.
export const SUGGESTION_MAX_STEP = 1;

const clampDifficulty = (value: number): number =>
  Math.min(MAX_DIFFICULTY, Math.max(MIN_DIFFICULTY, value));

// 수행 기록이 아직 없는 신규 사용자의 시작 난이도.
// 온보딩 성향을 반영해 내향형은 더 낮은 난이도에서 출발합니다.
export const seedDifficultyFromPersonality = (personality: PersonalityType | null): number => {
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

// 기준 난이도(최근 완료 미션 또는 성향 시드)에 성장 프로필의 제안을 반영한다.
//
// 제안이 없으면(프로필 없음·표본 부족·요약 실패) 기준 난이도를 그대로 쓴다 —
// 연속으로 같은 난이도를 이만큼 완료하면, 성장 프로필 제안이 없어도 한 단계 승급을 시도한다.
// 피드백 표본이 쌓이기 전(MIN_FEEDBACKS_FOR_PROFILE 미달)에는 suggestedDifficulty가 계속
// null이라 난이도가 영영 못 오르는 문제(#244)를 막기 위한 보조 신호다.
export const STREAK_PROMOTION_THRESHOLD = 3;

// recentMissions는 최신순이다. 맨 앞부터 같은 난이도가 몇 건 연속됐는지 센다.
// 이미 최고 난이도(MAX_DIFFICULTY)면 더 올릴 곳이 없으므로 0을 반환해 승급을 건너뛴다.
const countLeadingStreak = (recentMissions: { difficulty: number }[]): number => {
  if (recentMissions.length === 0) return 0;
  const current = recentMissions[0].difficulty;
  if (current >= MAX_DIFFICULTY) return 0;

  let streak = 0;
  for (const mission of recentMissions) {
    if (mission.difficulty !== current) break;
    streak += 1;
  }
  return streak;
};

// 기준 난이도(최근 완료 미션 또는 성향 시드)에 성장 프로필의 제안을 반영한다.
//
// 제안이 있으면(표본 충분) 그 신호를 우선한다. 제안이 없으면(프로필 없음·표본 부족·요약 실패)
// recentMissions의 연속 완료 횟수를 보조 신호로 써서 승급을 시도한다(#244) — 표본이 쌓이기
// 전까지 난이도가 한쪽에 고정되는 것을 막기 위함이다. 연속 기록도 없으면 기준 난이도를
// 그대로 유지한다 — 근거가 전혀 없을 때 임의로 흔드는 것보다 유지하는 편이 낫다.
export const decideDifficulty = (
  recentMissions: { difficulty: number }[],
  baseDifficulty: number,
  suggestedDifficulty: number | null
): DifficultyDecision => {
  const base = clampDifficulty(baseDifficulty);

  if (suggestedDifficulty !== null) {
    // 먼저 기준 난이도 ±SUGGESTION_MAX_STEP으로 자른 뒤, 다시 전체 범위로 자른다.
    // 순서가 중요하다 — 전체 범위로만 자르면 제안이 1에서 3으로 한 번에 뛸 수 있다.
    const stepped = Math.min(
      base + SUGGESTION_MAX_STEP,
      Math.max(base - SUGGESTION_MAX_STEP, suggestedDifficulty)
    );
    const target = clampDifficulty(stepped);

    return {
      baseDifficulty: base,
      targetDifficulty: target,
      source: target === base ? "base" : "growth_profile",
    };
  }

  // 성장 프로필 제안이 없을 때만 연속 완료 승급을 본다 — 제안이 있으면 그게 더 정확한 신호다.
  const streak = countLeadingStreak(recentMissions);
  if (streak >= STREAK_PROMOTION_THRESHOLD) {
    const target = clampDifficulty(base + 1);
    return { baseDifficulty: base, targetDifficulty: target, source: "streak_promotion" };
  }

  return { baseDifficulty: base, targetDifficulty: base, source: "base" };
};

// 1단계 컨텍스트 → 이후 단계(템플릿 조회 / LLM 프롬프트)로 넘길 최종 추천 기준.
export const buildRecommendationCriteria = (context: UserContext): RecommendationCriteria => {
  const difficulty = decideDifficulty(
    context.recentMissions,
    context.baseDifficulty,
    context.suggestedDifficulty
  );

  return {
    userId: context.userId,
    targetDifficulty: difficulty.targetDifficulty,
    preferredInterests: context.interests,
    personalityType: context.personalityType,
    isColdStart: context.isColdStart,
    difficulty,
  };
};