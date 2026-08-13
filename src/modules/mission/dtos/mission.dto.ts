// modules/mission/dtos/mission.dto.ts
import { z } from "zod";
import { DATE_ONLY_PATTERN } from "../../../shared/utils/date";
import { MissionDifficultyLabel, MissionOrigin } from "./mission.constants";

// ── 미션 준비 정보(Mission_Setups) — #152 ──
// 미션 창에서 사용자가 고르는 6개 축. Missions.setup_guideline(#148-150)의 defaults/disabled와
// 동일한 값 집합을 쓴다 — 서버가 이 enum 밖의 값을 받으면 안 되므로 zod로 강제한다.
export type MissionSetupEnvironment = "school" | "workplace" | "daily_place" | "community" | "online";
export type MissionSetupPartnerRole = "friend" | "senior" | "junior" | "peer" | "other";
export type MissionSetupPartnerGender = "male" | "female";
export type MissionSetupPartnerAgeGroup =
  | "teens"
  | "twenties"
  | "thirties"
  | "forties"
  | "fifties"
  | "sixties_plus";

const missionSetupEnvironmentValues = ["school", "workplace", "daily_place", "community", "online"] as const;
const missionSetupPartnerRoleValues = ["friend", "senior", "junior", "peer", "other"] as const;
const missionSetupPartnerGenderValues = ["male", "female"] as const;
const missionSetupPartnerAgeGroupValues = [
  "teens",
  "twenties",
  "thirties",
  "forties",
  "fifties",
  "sixties_plus",
] as const;

// 관계 친밀도/대화 예절 수준 5단계(1~5). 둘 다 같은 범위라 스키마를 공유한다.
const levelSchema = z.number().int().min(1).max(5);

// GET /missions/today, GET /missions/{missionId} 응답에 포함되는 미션 창 옵션 가이드라인.
// Missions.setup_guideline이 없거나(구버전 미션·템플릿·생성 실패) 형식이 깨져 있으면
// 서버는 null을 그대로 내려준다 — 이때 앱은 6개 축을 전부 활성 상태로, 자체 기본값으로 띄운다.
export interface SetupGuidelineAxisValues<T> {
  environment: T;
  partnerRole: T;
  intimacyLevel: T;
  formalityLevel: T;
  partnerGender: T;
  partnerAgeGroup: T;
}

export interface SetupGuidelineDto {
  defaults: {
    environment: MissionSetupEnvironment;
    partnerRole: MissionSetupPartnerRole;
    intimacyLevel: number;
    formalityLevel: number;
    partnerGender: MissionSetupPartnerGender;
    partnerAgeGroup: MissionSetupPartnerAgeGroup;
  };
  disabled: {
    environment: MissionSetupEnvironment[];
    partnerRole: MissionSetupPartnerRole[];
    intimacyLevel: number[];
    formalityLevel: number[];
    partnerGender: MissionSetupPartnerGender[];
    partnerAgeGroup: MissionSetupPartnerAgeGroup[];
  };
  note: string | null;
  recommendedTopics: string[];
  tags: string[];
}

// Missions.setup_guideline(Json) 파싱용. LLM이 만든 값이라 형식이 깨질 수 있으므로,
// 검증에 실패하면 서비스 레이어에서 null로 취급한다(미션 조회 자체는 실패하면 안 된다).
export const setupGuidelineSchema = z.object({
  defaults: z.object({
    environment: z.enum(missionSetupEnvironmentValues),
    partnerRole: z.enum(missionSetupPartnerRoleValues),
    intimacyLevel: levelSchema,
    formalityLevel: levelSchema,
    partnerGender: z.enum(missionSetupPartnerGenderValues),
    partnerAgeGroup: z.enum(missionSetupPartnerAgeGroupValues),
  }),
  disabled: z.object({
    environment: z.array(z.enum(missionSetupEnvironmentValues)),
    partnerRole: z.array(z.enum(missionSetupPartnerRoleValues)),
    intimacyLevel: z.array(levelSchema),
    formalityLevel: z.array(levelSchema),
    partnerGender: z.array(z.enum(missionSetupPartnerGenderValues)),
    partnerAgeGroup: z.array(z.enum(missionSetupPartnerAgeGroupValues)),
  }),
  note: z.string().nullable(),
  recommendedTopics: z.array(z.string()),
  tags: z.array(z.string()),
}) satisfies z.ZodType<SetupGuidelineDto>;

// POST /missions/{missionId}/setups
export interface CreateMissionSetupRequestDto {
  environment: MissionSetupEnvironment;
  partnerRole: MissionSetupPartnerRole;
  partnerGender: MissionSetupPartnerGender;
  partnerAgeGroup: MissionSetupPartnerAgeGroup;
  intimacyLevel: number;
  formalityLevel: number;
}

export const createMissionSetupRequestSchema = z.object({
  environment: z.enum(missionSetupEnvironmentValues),
  partnerRole: z.enum(missionSetupPartnerRoleValues),
  partnerGender: z.enum(missionSetupPartnerGenderValues),
  partnerAgeGroup: z.enum(missionSetupPartnerAgeGroupValues),
  intimacyLevel: levelSchema,
  formalityLevel: levelSchema,
}) satisfies z.ZodType<CreateMissionSetupRequestDto>;

export interface CreateMissionSetupResponseDto {
  missionSetupId: string;
  createdAt: string;
}

export interface MissionListItemDto {
  id: string;
  title: string;
  category: string;
  difficulty: MissionDifficultyLabel;
  estimatedMinutes: number;
  rewardXp: number;
  isSaved: boolean;
  /**
   * 이 미션의 출처. template=관리자가 만든 템플릿 미션,
   * ai=추천으로 생성된 미션(내 것이거나, 나와 같은 성향의 사용자가 수행한 것).
   */
  origin: MissionOrigin;
  /** AI 생성 미션 중 내가 만든 것인지. 템플릿 미션은 항상 false. */
  isMine: boolean;
}

// GET /missions
export interface GetMissionsQueryDto {
  difficulty?: MissionDifficultyLabel;
  category?: string;
  saved?: boolean;
  /** 지정하면 해당 출처만 조회한다(프런트에서 섹션을 나눠 보여줄 때 사용). */
  origin?: MissionOrigin;
  page?: number;
  size?: number;
}

export const getMissionsQuerySchema = z.object({
  difficulty: z.enum(["쉬움", "보통", "어려움"]).optional(),
  category: z.string().optional(),
  saved: z.coerce.boolean().optional(),
  origin: z.enum(["template", "ai"]).optional(),
  page: z.coerce.number().int().positive().optional(),
  size: z.coerce.number().int().positive().max(100).optional(),
}) satisfies z.ZodType<GetMissionsQueryDto>;

export interface MissionPageInfoDto {
  currentPage: number;
  totalPages: number;
  totalCount: number;
}

export interface MissionListResponseDto {
  missions: MissionListItemDto[];
  pageInfo: MissionPageInfoDto;
}

// GET /missions/llm-health (진단용 — Upstage LLM 연결 상태 점검)
export interface LlmHealthResponseDto {
  connected: boolean; // LLM 호출 성공 여부
  model: string; // 점검에 사용한 모델명
  sample?: string; // 연결 성공 시 응답 일부
  reason?: string; // 실패 사유 (no_api_key / http_xxx / timeout / network_error)
}

// GET /missions/today (AI 추천 — recommendation.service.recommendMission 결과를 매핑)
export interface GetTodayMissionQueryDto {
  /**
   * 클라이언트 기준 오늘 날짜(YYYY-MM-DD). 이 날짜로 하루 1건 캐시와 새로고침 횟수를 센다.
   * 생략하면 서버(KST) 기준 오늘을 쓴다. 서버 기준 오늘과 하루 넘게 차이 나면 400.
   * @example "2026-07-27"
   */
  date?: string;
  /**
   * true면 오늘 추천이 이미 있어도 새로 뽑는다(LLM 재호출). 하루 3회까지 가능하며
   * 모두 소진하면 429 MISSION_REFRESH_LIMIT_EXCEEDED.
   * 생략/false면 오늘 추천이 있을 때 그대로 돌려준다.
   * @example false
   */
  refresh?: boolean;
}

export const getTodayMissionQuerySchema = z.object({
  date: z
    .string()
    .regex(DATE_ONLY_PATTERN, "date는 YYYY-MM-DD 형식이어야 합니다.")
    .optional(),
  refresh: z.coerce.boolean().optional(),
}) satisfies z.ZodType<GetTodayMissionQueryDto>;

export interface TodayMissionResponseDto {
  /**
   * 이 추천에 해당하는 Missions.id. 추천과 같은 트랜잭션에서 실제 미션 행까지 만들고
   * 추천 로그에 백링크하므로 **항상 값이 있다**. 앱은 별도 저장 요청 없이 바로 대화를
   * 시작할 수 있다.
   */
  missionId: string;
  title: string;
  category: string;
  difficulty: MissionDifficultyLabel;
  estimatedMinutes: number;
  rewardXp: number;
  description: string;
  reason: string; // 추천 이유 (Requirement 3.2)
  expectedEffect: string; // 기대 효과 (Requirement 3.2)
  source: "template" | "fallback" | "llm"; // 어느 단계가 만든 추천인지
  isSaved: boolean;
  /** 이 추천을 만든 Recommendation_Logs 행의 id. LLM 호출 전에 선점하므로 항상 값이 있다. */
  recommendationLogId: string;
  /** 이 추천이 속한 날짜(YYYY-MM-DD). 요청한 date를 그대로 돌려준다. */
  date: string;
  /** 오늘 이미 사용한 새로고침 횟수. */
  refreshCount: number;
  /** 하루 새로고침 상한(현재 3). */
  refreshLimit: number;
  /** 남은 새로고침 횟수. 0이면 새로고침 요청 시 429. */
  remainingRefreshes: number;
  /** 이번 호출에서 새로 추천을 뽑았는지. false면 오늘 이미 있던 추천을 그대로 돌려준 것. */
  isNew: boolean;
  /** #152 — 미션 창 옵션 가이드라인. Missions.setup_guideline이 없거나 형식이 깨져 있으면 null. */
  setupGuideline: SetupGuidelineDto | null;
}

// POST /missions/from-recommendation
// GET /missions/today가 이미 실제 미션까지 만들어 두므로 대화 시작에는 필요하지 않다.
// 이전 버전 앱 호환과, 추천 로그만 있고 미션이 없는 과거 데이터를 살리기 위한 멱등 API다
// (이미 백링크가 있으면 그 id를 그대로 돌려준다).
export interface SaveRecommendedMissionRequestDto {
  recommendationLogId: string;
}

export const saveRecommendedMissionRequestSchema = z.object({
  recommendationLogId: z.string().uuid({ message: "recommendationLogId는 UUID 형식이어야 합니다." }),
}) satisfies z.ZodType<SaveRecommendedMissionRequestDto>;

export interface SaveRecommendedMissionResponseDto {
  missionId: string; // 새로 생성됐거나(최초 호출) 이미 있던(재요청·template) 실제 Missions.id
}

// GET /missions/{missionId}
export interface MissionDetailResponseDto {
  id: string;
  title: string;
  category: string;
  difficulty: MissionDifficultyLabel;
  estimatedMinutes: number;
  rewardXp: number;
  description: string;
  preparationTip: string | null;
  caution: string | null;
  isSaved: boolean;
  /** #152 — 미션 창 옵션 가이드라인. Missions.setup_guideline이 없거나 형식이 깨져 있으면 null. */
  setupGuideline: SetupGuidelineDto | null;
}

// GET /missions/{missionId}/prep
export type MissionPrepItemType = "question" | "starter" | "tip";

export interface MissionPrepItemDto {
  id: string;
  type: MissionPrepItemType;
  content: string;
  orderIndex: number;
}

export interface MissionPrepResponseDto {
  missionId: string;
  totalCount: number;
  items: MissionPrepItemDto[];
}

// POST /missions/{missionId}/save
export interface MissionSaveResponseDto {
  missionId: string;
  isSaved: true;
  savedAt: string;
}

// DELETE /missions/{missionId}/save
export interface MissionUnsaveResponseDto {
  missionId: string;
  isSaved: false;
}

// POST /missions/{missionId}/setup-guideline/regenerate
export interface SetupGuidelineRegenerateResponseDto {
  missionId: string;
  setupGuideline: SetupGuidelineDto;
}