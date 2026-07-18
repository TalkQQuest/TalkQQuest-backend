import { MissionResult, PersonalityType } from "@prisma/client";

// AI 미션 추천 파이프라인의 입력/중간 산출물 타입입니다.
// 1단계(컨텍스트 조립) → 2단계(규칙 기반 난이도/필터) → (이후) 3단계 템플릿 폴백 / 4단계 LLM 생성으로 이어집니다.
// 이 계층까지는 AI 호출이 전혀 없고, DB 값만으로 결정론적으로 계산됩니다.

// 최근 수행 기록 1건 (Mission_Records + Missions 조인 결과를 추천에 필요한 필드만 평탄화).
export interface RecentMissionRecord {
  missionId: string;
  title: string;
  category: string;
  difficulty: number; // 1=쉬움, 2=보통, 3=어려움
  result: MissionResult; // success | failure | avoidance
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
}

// 2단계 산출물 일부: 난이도가 왜 이렇게 정해졌는지 추적용.
export type DifficultyAdjustmentReason =
  | "lowered_repeated_avoidance" // 반복 회피/실패 → 하향
  | "raised_streak_success" // 연속 성공 → 상향
  | "kept"; // 유지

export interface DifficultyAdjustment {
  baseDifficulty: number;
  adjustedDifficulty: number;
  reason: DifficultyAdjustmentReason;
}

// 2단계 최종 산출물: 이후 템플릿 조회/LLM 프롬프트에 힌트로 넘길 추천 기준.
export interface RecommendationCriteria {
  userId: string;
  targetDifficulty: number; // 실제로 추천할 난이도 (조정 반영)
  avoidedCategories: string[]; // 반복 회피/실패한 카테고리 → 추천에서 제외
  preferredInterests: string[];
  personalityType: PersonalityType | null;
  isColdStart: boolean;
  difficultyAdjustment: DifficultyAdjustment;
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
}
