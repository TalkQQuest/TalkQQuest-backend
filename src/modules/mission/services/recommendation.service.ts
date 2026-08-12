import { logger } from "../../../config/logger";
import { getGrowthProfileForRecommendation } from "../../growth/services/growth-profile.service";
import {
  RecentMissionRecord,
  RecommendationCriteria,
  RecommendedMission,
  UserContext,
} from "../dtos/recommendation.dto";
import { MissionProfileNotFoundError } from "../errors/mission.error";
import {
  updateRecommendationLog,
  findActiveGoalsByUserId,
  findRecentMissionRecords,
  findUserProfileByUserId,
} from "../repositories/mission.repository";
import { buildRecommendationCriteria, seedDifficultyFromPersonality } from "./difficulty.service";
import { generateMissionWithLlm, LlmGenerationResult } from "./llm.service";
import { recommendFromTemplate } from "./template.service";

// 1단계 — 추천 컨텍스트 조립.
// User_Profiles + Goals + 최근 Mission_Records를 읽어 UserContext 하나로 모읍니다.
// AI 호출은 없습니다. 이 컨텍스트가 2단계(규칙 난이도/필터)와 이후 LLM 프롬프트의 입력이 됩니다.

// 난이도 조정·회피 판단에 참고할 최근 기록 건수.
const RECENT_RECORDS_LIMIT = 5;

// User_Profiles.interests / difficult_situations는 Json 컬럼이라 unknown으로 들어옵니다.
// 문자열 배열만 안전하게 추출합니다(형식이 어긋나면 빈 배열).
const toStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
};

export const assembleUserContext = async (userId: string): Promise<UserContext> => {
  const profile = await findUserProfileByUserId(userId);

  // 온보딩 미완료면 추천 기준을 만들 수 없음 → 호출부가 온보딩 유도/폴백 처리.
  if (!profile || !profile.onboarding_completed) {
    throw new MissionProfileNotFoundError();
  }

  // 성장 프로필은 실패해도 추천을 막지 않는다(서비스가 내부에서 삼키고 null을 반환).
  const [goals, records, growth] = await Promise.all([
    findActiveGoalsByUserId(userId),
    findRecentMissionRecords(userId, RECENT_RECORDS_LIMIT),
    getGrowthProfileForRecommendation(userId),
  ]);

  const recentMissions: RecentMissionRecord[] = records.map((record) => ({
    missionId: record.mission.id,
    title: record.mission.title,
    category: record.mission.category,
    difficulty: record.mission.difficulty,
    createdAt: record.created_at,
  }));

  const isColdStart = recentMissions.length === 0;
  // 기준 난이도: 기록이 있으면 가장 최근 미션 난이도, 없으면 성향 기반 시드.
  const baseDifficulty = isColdStart
    ? seedDifficultyFromPersonality(profile.personality_type)
    : recentMissions[0].difficulty;

  return {
    userId,
    personalityType: profile.personality_type,
    statusType: profile.status_type,
    difficultSituations: toStringArray(profile.difficult_situations),
    interests: toStringArray(profile.interests),
    goals: [...new Set(goals.map((goal) => goal.target))],
    // purpose는 "연습하고 싶은 대화 유형 배열"(Json)로 바뀌어 문자열만 추출한다.
    practiceTypes: toStringArray(profile.purpose),
    level: profile.level,
    baseDifficulty,
    recentMissions,
    isColdStart,
    // 콜드스타트에서는 성장 프로필의 제안을 쓰지 않는다. 기준 난이도가 성향 시드라
    // 근거가 다른 두 값을 섞게 되고, 수행 기록이 없는 사용자에게 프로필이 있다는 것 자체가
    // 정상 상태가 아니다(피드백은 대화를 해야 생긴다).
    suggestedDifficulty: isColdStart ? null : (growth?.suggestedDifficulty ?? null),
    growth: growth
      ? {
          summary: growth.summary,
          strengths: growth.strengths,
          improvements: growth.improvements,
          // 프롬프트에는 조합만 넘기고 횟수는 뺀다 — 모델이 숫자를 그대로 인용해
          // "3번 실패하셨네요" 같은 문장을 만드는 것을 막는다.
          struggleSituations: growth.struggleSituations.map((situation) => ({
            environment: situation.environment,
            partnerRole: situation.partnerRole,
            category: situation.category,
          })),
        }
      : null,
  };
};

// 1~2단계를 한 번에: 컨텍스트를 조립하고 규칙 기반 추천 기준까지 계산.
// 이후 3단계(템플릿 조회)·4단계(LLM 생성)가 이 criteria를 입력으로 받습니다.
export const buildRecommendationInput = async (
  userId: string
): Promise<{ context: UserContext; criteria: RecommendationCriteria }> => {
  const context = await assembleUserContext(userId);
  const criteria = buildRecommendationCriteria(context);
  return { context, criteria };
};

// 추천 진입점 (1→2→3→4단계). GET /missions/today 등이 이 함수를 쓴다.
// 4단계 LLM 생성을 먼저 시도하고, 실패하거나 키가 없으면 3단계 템플릿으로 폴백한다.
// 매 호출을 Recommendation_Logs에 기록한다(품질 개선·오류 추적 + missionId가 null인
// llm/fallback 추천을 나중에 실제 Missions로 저장할 때 원본을 식별하는 용도).
//
// reservedLogId는 호출부가 LLM 호출 전에 선점해 둔 로그 행이다. 로그를 여기서 새로 만들지
// 않고 그 행을 채우는 이유는, 로그가 곧 오늘의 미션 캐시이자 새로고침 카운터이기 때문이다.
// 사후에 만들다 실패하면 캐시가 비어 다음 요청이 LLM을 다시 부르고 한도도 세지 못한다.
export const recommendMission = async (
  userId: string,
  reservedLogId: string
): Promise<RecommendedMission> => {
  const { context, criteria } = await buildRecommendationInput(userId);
  const attempt = await generateMissionWithLlm(context, criteria);
  const mission = attempt.mission ?? (await recommendFromTemplate(criteria));

  await writeRecommendationLogSafe(reservedLogId, criteria, attempt, mission);
  return { ...mission, recommendationLogId: reservedLogId };
};

// 예약 행에 추천 결과를 기록한다. 실패해도 추천 응답 자체는 막지 않는다 —
// 예약 행은 이미 있으므로 슬롯 계산은 어긋나지 않고, 비어 있는 캐시는 다음 조회에서
// 파싱 실패로 걸러져 새 추천으로 넘어간다.
const writeRecommendationLogSafe = async (
  logId: string,
  criteria: RecommendationCriteria,
  attempt: LlmGenerationResult,
  mission: RecommendedMission
): Promise<void> => {
  try {
    await updateRecommendationLog(logId, {
      source: mission.source, // llm / template / fallback
      llmModel: attempt.llmModel,
      targetDifficulty: criteria.targetDifficulty,
      // #150 — 회피 카테고리는 더 이상 계산하지 않는다(항상 빈 배열이었다).
      // 컬럼은 과거 로그 해석을 위해 남기고 앞으로는 null만 기록한다.
      avoidedCategories: null,
      promptInput: attempt.promptInput,
      rawResponse: attempt.rawResponse,
      parseSuccess: attempt.parseSuccess,
      recommendedMission: mission,
      fallbackReason: attempt.fallbackReason,
    });
  } catch (error) {
    logger.warn({ err: error }, "추천 로그 기록 실패 (추천 자체는 정상 반환)");
  }
};
