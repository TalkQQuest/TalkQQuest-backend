// modules/mission/dtos/mission.dto.ts
import { z } from "zod";
import { DATE_ONLY_PATTERN } from "../../../shared/utils/date";
import { MissionDifficultyLabel, MissionOrigin } from "./mission.constants";

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
   * 이 추천에 해당하는 Missions.id. 추천 시점에 실제 미션 행까지 만들어 두므로 항상 값이 있다.
   * (추천 로그 저장 자체가 실패한 예외적인 경우에만 null — 그때는 대화를 시작할 수 없다.)
   */
  missionId: string | null;
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
  // 이 추천을 만든 Recommendation_Logs 행의 id. 로깅이 실패했을 때만 null.
  recommendationLogId: string | null;
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
}

// POST /missions/from-recommendation
// GET /missions/today가 llm/fallback으로 추천한 미션(missionId=null)을 실제 Missions로 저장한다.
// 이미 실제 미션인 템플릿 추천(missionId 있음)은 이 API 없이 바로 대화를 시작할 수 있다.
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