import {
  RecommendationCriteria,
  RecommendedMission,
  TemplateMissionCandidate,
} from "../dtos/recommendation.dto";
import { findTemplateMissions } from "../repositories/mission.repository";

// 3단계 — 템플릿 기반 추천 + 최종 폴백.
// 규칙 기반 criteria(2단계)로 미리 시드된 미션 중 하나를 고른다.
// LLM(4단계)이 실패하거나 JSON이 깨졌을 때 돌아올 안전망이기도 하다.
// 선택 로직은 순수 함수라 DB 없이 단위 테스트가 가능하다.

// DB에 매칭되는 템플릿이 하나도 없을 때 돌려주는 하드코딩 입문 미션.
// "추천 데이터 부족" 상황에서도 화면이 비지 않도록 항상 무언가는 반환한다(명세서 예외 E-1 패턴).
export const INTRO_FALLBACK_MISSION: RecommendedMission = {
  missionId: null,
  title: "편의점에서 점원에게 먼저 인사하기",
  description: "물건을 계산할 때 먼저 '안녕하세요'라고 인사해보세요.",
  difficulty: 1,
  estimatedMinutes: 5,
  category: "짧은 대화",
  rewardXp: 10,
  reason: "가장 작은 성공 경험부터 시작할 수 있는 입문 미션이에요.",
  expectedEffect: "작은 성공으로 대화 자신감을 얻습니다.",
  preparationTip: "계산대에 다가가기 전, 가볍게 미소 짓는 연습을 해보세요.",
  caution: "점원이 바빠 보이면 짧은 인사만으로도 충분합니다.",
  source: "fallback",
  setupGuideline: null,
  recommendationLogId: null,
};

// 후보의 카테고리/제목이 사용자 관심사 중 하나라도 포함하는지.
const matchesInterest = (
  candidate: TemplateMissionCandidate,
  interests: string[]
): boolean =>
  interests.some(
    (interest) => candidate.category.includes(interest) || candidate.title.includes(interest)
  );

// 후보 중 하나를 고른다. 정렬 우선순위:
// 1) 목표 난이도에 가까운 것  2) 관심사와 맞는 것  3) 원래 순서(안정 정렬)
//
// #150 — 회피 카테고리 제외가 사라졌다. 그 목록은 Mission_Records.result로 만들어졌는데
// result에는 항상 success가 들어와 한 번도 채워지지 않았다(항상 빈 배열).
export const pickTemplateMission = (
  candidates: TemplateMissionCandidate[],
  criteria: RecommendationCriteria
): TemplateMissionCandidate | null => {
  if (candidates.length === 0) {
    return null;
  }

  const scored = candidates.map((candidate, index) => ({
    candidate,
    index,
    difficultyGap: Math.abs(candidate.difficulty - criteria.targetDifficulty),
    interestRank: matchesInterest(candidate, criteria.preferredInterests) ? 0 : 1,
  }));

  scored.sort(
    (a, b) =>
      a.difficultyGap - b.difficultyGap ||
      a.interestRank - b.interestRank ||
      a.index - b.index
  );

  return scored[0].candidate;
};

// 왜 이 미션을 골랐는지 결정론적으로 한 줄 설명(템플릿엔 reason 컬럼이 없으므로 criteria로 생성).
export const buildTemplateReason = (criteria: RecommendationCriteria): string => {
  if (criteria.isColdStart) {
    return "온보딩에서 고른 성향을 반영한 첫 미션이에요.";
  }
  // 난이도가 성장 프로필 제안으로 움직였을 때만 그 사실을 알린다.
  // 방향까지 문구에 담는 이유 — "낮췄다"만 보이면 사용자가 후퇴로 읽을 수 있어,
  // 무엇을 근거로 조정했는지 함께 말한다.
  if (criteria.difficulty.source === "growth_profile") {
    return criteria.difficulty.targetDifficulty < criteria.difficulty.baseDifficulty
      ? "최근 대화 피드백을 반영해 조금 편한 난이도로 골랐어요."
      : "최근 대화 피드백이 좋아 한 단계 올린 미션이에요.";
  }
  return "지금 수준에 맞춰 고른 미션이에요.";
};

const toRecommendedMission = (
  candidate: TemplateMissionCandidate,
  criteria: RecommendationCriteria
): RecommendedMission => ({
  missionId: candidate.id,
  title: candidate.title,
  description: candidate.description,
  difficulty: candidate.difficulty,
  estimatedMinutes: candidate.estimatedMinutes,
  category: candidate.category,
  rewardXp: candidate.rewardXp,
  reason: buildTemplateReason(criteria),
  expectedEffect: "작은 대화 시도를 반복하며 사회적 자신감을 쌓습니다.",
  // 템플릿은 LLM 없이 DB에 미리 시드된 미션이라 준비 팁/주의사항을 생성하지 않는다(#194).
  preparationTip: null,
  caution: null,
  source: "template",
  setupGuideline: null,
  recommendationLogId: null,
});

// Prisma Missions row → 순수 함수가 다루는 후보 타입으로 평탄화.
const toCandidate = (row: {
  id: string;
  title: string;
  description: string;
  difficulty: number;
  estimated_minutes: number;
  reward_xp: number;
  category: string;
}): TemplateMissionCandidate => ({
  id: row.id,
  title: row.title,
  description: row.description,
  difficulty: row.difficulty,
  estimatedMinutes: row.estimated_minutes,
  rewardXp: row.reward_xp,
  category: row.category,
});

// 3단계 진입점: 템플릿 미션을 가져와 하나 고르고, 없으면 입문 폴백을 반환.
export const recommendFromTemplate = async (
  criteria: RecommendationCriteria
): Promise<RecommendedMission> => {
  const rows = await findTemplateMissions();
  const picked = pickTemplateMission(rows.map(toCandidate), criteria);

  if (!picked) {
    return INTRO_FALLBACK_MISSION;
  }
  return toRecommendedMission(picked, criteria);
};
