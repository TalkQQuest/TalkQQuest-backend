import { PersonalityType } from "@prisma/client";
import type { SetupGuidelineDto } from "./mission.dto";

// AI 미션 추천 파이프라인의 입력/중간 산출물 타입입니다.
// 1단계(컨텍스트 조립) → 2단계(규칙 기반 난이도/필터) → (이후) 3단계 템플릿 폴백 / 4단계 LLM 생성으로 이어집니다.
// 이 계층까지는 AI 호출이 전혀 없고, DB 값만으로 결정론적으로 계산됩니다.

// 최근 수행 기록 1건 (Mission_Records + Missions 조인 결과를 추천에 필요한 필드만 평탄화).
//
// #150 — result(success/failure/avoidance)는 더 이상 담지 않는다. 미션-대화에 실패라는 개념이
// 없어 항상 success가 들어오므로 신호가 되지 못하고, 그 값을 근거로 삼던 규칙이 난이도를
// 한쪽 끝에 고정시켰다. 수행 성향은 이제 피드백 기반 성장 프로필이 담당한다.
export interface RecentMissionRecord {
  missionId: string;
  title: string;
  category: string;
  difficulty: number; // 1=쉬움, 2=보통, 3=어려움
  createdAt: Date;
}

// 1단계 산출물: 추천 판단에 필요한 사용자 상태를 한 객체로 모은 것.
export interface UserContext {
  userId: string;
  personalityType: PersonalityType | null;
  statusType: string | null; // 현재 신분/상황 (예: 새내기, 복학생)
  difficultSituations: string[]; // 대화가 어려운 상황
  interests: string[];
  goals: string[]; // Goals.target 목록
  practiceTypes: string[]; // 연습하고 싶은 대화 유형 (User_Profiles.purpose, 최대 2개)
  level: number;
  baseDifficulty: number; // 조정 전 기준 난이도 (최근 미션 or 성향 시드)
  recentMissions: RecentMissionRecord[]; // 최신순
  isColdStart: boolean; // 온보딩만 완료, 수행 기록이 없는 신규 사용자
  // 성장 프로필(User_Growth_Profiles)이 제안한 난이도. 프로필이 없거나 표본이 부족하면 null.
  suggestedDifficulty: number | null;
  // 프롬프트에 넣을 성장 요약. 프로필이 없으면 null.
  growth: GrowthHint | null;
}

// 추천 프롬프트에 넣을 성장 프로필 발췌.
// 프로필 전체가 아니라 프롬프트에 실제로 쓰는 부분만 옮겨 담는다 —
// 추천 계층이 성장 프로필의 저장 형태(Json 컬럼)에 직접 묶이지 않게 하기 위함이다.
export interface GrowthHint {
  summary: string | null;
  strengths: string[];
  improvements: string[];
  struggleSituations: { environment: string | null; partnerRole: string | null; category: string }[];
}

// 2단계 산출물 일부: 난이도가 어디서 왔는지 추적용(추천 로그에 남는다).
export interface DifficultyDecision {
  baseDifficulty: number; // 최근 완료 미션 난이도 또는 성향 시드
  targetDifficulty: number; // 성장 프로필 제안을 ±1로 클램프한 최종값
  // base = 제안이 없거나 클램프 결과가 기준과 같음 / growth_profile = 제안이 반영됨
  source: "base" | "growth_profile";
}

// 2단계 최종 산출물: 이후 템플릿 조회/LLM 프롬프트에 힌트로 넘길 추천 기준.
export interface RecommendationCriteria {
  userId: string;
  targetDifficulty: number; // 실제로 추천할 난이도
  preferredInterests: string[];
  personalityType: PersonalityType | null;
  isColdStart: boolean;
  difficulty: DifficultyDecision;
}

// 3단계 후보: 템플릿 선택 로직(순수 함수)에 넘기는 Missions의 최소 필드.
// Prisma 모델과 서비스 로직을 분리하기 위해 별도 타입으로 둔다.
export interface TemplateMissionCandidate {
  id: string;
  title: string;
  description: string;
  difficulty: number;
  estimatedMinutes: number;
  rewardXp: number;
  category: string;
}

// 추천 결과의 통일된 출력 형태.
// 3단계(템플릿/폴백)와 4단계(LLM 생성)가 모두 이 형태로 반환한다.
export interface RecommendedMission {
  missionId: string | null; // 템플릿이면 Missions.id, LLM 생성이면 아직 미저장이라 null
  title: string;
  description: string;
  difficulty: number;
  estimatedMinutes: number;
  category: string;
  rewardXp: number;
  reason: string; // 추천 이유
  expectedEffect: string; // 기대 효과
  source: "template" | "fallback" | "llm"; // 어느 단계가 만든 결과인지
  // LLM 생성 미션은 함께 만든 가이드라인을 담고, 기존 로그·템플릿·폴백은 null일 수 있다.
  setupGuideline: SetupGuidelineDto | null;
  // 이 추천을 만든 Recommendation_Logs 행의 id. missionId가 null인 llm/fallback 추천을
  // 실제 Missions로 저장할 때(POST /missions/from-recommendation) 원본을 식별하는 데 쓴다.
  // 로깅 자체가 실패했을 때만 null (추천 응답은 그대로 반환되므로 그 경우도 대비해야 한다).
  recommendationLogId: string | null;
}
