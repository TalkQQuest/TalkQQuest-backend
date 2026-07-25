// modules/xp/dtos/xp.dto.ts
import { z } from "zod";

// GET /xp/summary
export interface XpSummaryResponseDto {
  level: number;
  currentXp: number; // 현재 레벨 내 진행도 (User_Profiles.xp — 레벨업 시 차감되므로 누적이 아님)
  nextLevelXp: number; // 다음 레벨까지 필요한 XP (level.service.calculateNextLevelXp)
  totalXp: number; // 누적 경험치 (XP_History 합계)
}

// GET /xp/history
export interface XpHistoryItemDto {
  id: string;
  amount: number; // 양수=획득, 음수=차감
  reason: string;
  referenceId: string | null;
  referenceType: string | null; // mission_record / badge / event 등
  createdAt: string;
}

export interface XpPageInfoDto {
  currentPage: number;
  totalPages: number;
  totalCount: number;
}

export interface XpHistoryResponseDto {
  items: XpHistoryItemDto[];
  pageInfo: XpPageInfoDto;
}

export interface GetXpHistoryQueryDto {
  page?: number;
  size?: number;
}

export const getXpHistoryQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  size: z.coerce.number().int().positive().max(100).optional(),
}) satisfies z.ZodType<GetXpHistoryQueryDto>;
