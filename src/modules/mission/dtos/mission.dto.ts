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