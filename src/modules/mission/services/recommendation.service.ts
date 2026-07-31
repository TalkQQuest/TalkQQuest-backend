import { logger } from "../../../config/logger";
import {
  RecentMissionRecord,
  RecommendationCriteria,
  RecommendedMission,
  UserContext,
} from "../dtos/recommendation.dto";
import { MissionProfileNotFoundError } from "../errors/mission.error";
import {
  createRecommendationLog,
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

  const [goals, records] = await Promise.all([
    findActiveGoalsByUserId(userId),
    findRecentMissionRecords(userId, RECENT_RECORDS_LIMIT),
  ]);

  const recentMissions: RecentMissionRecord[] = records.map((record) => ({
    missionId: record.mission.id,
    title: record.mission.title,
    category: record.mission.category,
    difficulty: record.mission.difficulty,
    result: record.result,
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
// recommendedDate는 이 추천이 속한 "하루" 버킷이다. 호출부(getTodayMission)가 오늘 추천을
// 캐시하고 새로고침 횟수를 세는 기준이라 로그에 반드시 함께 남긴다.
export const recommendMission = async (
  userId: string,
  recommendedDate: Date
): Promise<RecommendedMission> => {
  const { context, criteria } = await buildRecommendationInput(userId);
  const attempt = await generateMissionWithLlm(context, criteria);
  const mission = attempt.mission ?? (await recommendFromTemplate(criteria));

  const recommendationLogId = await logRecommendationSafe(
    userId,
    criteria,
    attempt,
    mission,
    recommendedDate
  );
  return { ...mission, recommendationLogId };
};

// 추천 결과 로깅. 성공하면 로그 id, 실패하면 null(로깅 실패가 추천 응답 자체를 막지 않는다).
const logRecommendationSafe = async (
  userId: string,
  criteria: RecommendationCriteria,
  attempt: LlmGenerationResult,
  mission: RecommendedMission,
  recommendedDate: Date
): Promise<string | null> => {
  try {
    const log = await createRecommendationLog({
      userId,
      source: mission.source, // llm / template / fallback
      llmModel: attempt.llmModel,
      targetDifficulty: criteria.targetDifficulty,
      avoidedCategories: criteria.avoidedCategories,
      promptInput: attempt.promptInput,
      rawResponse: attempt.rawResponse,
      parseSuccess: attempt.parseSuccess,
      recommendedMission: mission,
      fallbackReason: attempt.fallbackReason,
      recommendedDate,
    });
    return log.id;
  } catch (error) {
    logger.warn({ err: error }, "추천 로그 저장 실패 (추천 자체는 정상 반환)");
    return null;
  }
};
