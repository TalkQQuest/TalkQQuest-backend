// modules/mission/dtos/mission.dto.ts
import { z } from "zod";
import { MissionDifficultyLabel } from "./mission.constants";

export interface MissionListItemDto {
  id: string;
  title: string;
  category: string;
  difficulty: MissionDifficultyLabel;
  estimatedMinutes: number;
  rewardXp: number;
  isSaved: boolean;
}

// GET /missions
export interface GetMissionsQueryDto {
  difficulty?: MissionDifficultyLabel;
  category?: string;
  saved?: boolean;
  page?: number;
  size?: number;
}

export const getMissionsQuerySchema = z.object({
  difficulty: z.enum(["쉬움", "보통", "어려움"]).optional(),
  category: z.string().optional(),
  saved: z.coerce.boolean().optional(),
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
export interface TodayMissionResponseDto {
  missionId: string | null; // 템플릿 추천이면 Missions.id, LLM/폴백 생성이면 아직 미저장이라 null
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