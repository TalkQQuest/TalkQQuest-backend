import {
  RecentMissionRecord,
  RecommendationCriteria,
  RecommendedMission,
  UserContext,
} from "../dtos/recommendation.dto";
import { MissionProfileNotFoundError } from "../errors/mission.error";
import {
  findActiveGoalsByUserId,
  findRecentMissionRecords,
  findUserProfileByUserId,
} from "../repositories/mission.repository";
import { buildRecommendationCriteria, seedDifficultyFromPersonality } from "./difficulty.service";
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

  // 목표 = 활성 Goals의 target + 프로필의 purpose(중복 제거).
  const goalTexts = goals.map((goal) => goal.target);
  if (typeof profile.purpose === "string" && profile.purpose) {
    goalTexts.push(profile.purpose);
  }

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
    goals: [...new Set(goalTexts)],
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

// 현재 동작하는 추천 진입점 (AI 없이 1→2→3단계).
// 4단계(LLM 생성)가 붙기 전까지 GET /missions/today 등이 이 함수를 쓰면 된다.
// LLM 추가 시엔 이 안에서 recommendFromTemplate를 폴백으로 두고 LLM을 먼저 시도하게 된다.
export const recommendMission = async (userId: string): Promise<RecommendedMission> => {
  const { criteria } = await buildRecommendationInput(userId);
  return recommendFromTemplate(criteria);
};
