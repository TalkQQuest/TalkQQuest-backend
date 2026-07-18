// modules/xp/services/xp.service.ts
import { NotFoundError } from "../../../shared/errors/common.error";
import * as xpRepository from "../repositories/xp.repository";
import {
  GetXpHistoryQueryDto,
  XpHistoryResponseDto,
  XpSummaryResponseDto,
} from "../dtos/xp.dto";
import { calculateNextLevelXp } from "./level.service";

const DEFAULT_PAGE = 1;
const DEFAULT_SIZE = 10;

export const getXpSummary = async (userId: string): Promise<XpSummaryResponseDto> => {
  const [profile, totals] = await Promise.all([
    xpRepository.findProfileXpByUserId(userId),
    xpRepository.sumXpAmountByUserId(userId),
  ]);

  if (!profile) throw new NotFoundError("사용자를 찾을 수 없습니다.");

  return {
    level: profile.level,
    currentXp: profile.xp,
    // 미션 완료의 레벨업 판정과 동일한 공식을 써야 하므로 level.service를 그대로 사용한다.
    nextLevelXp: calculateNextLevelXp(profile.level),
    // 지급 이력이 없으면 _sum.amount가 null이다.
    totalXp: totals._sum.amount ?? 0,
  };
};

export const getXpHistory = async (
  userId: string,
  query: GetXpHistoryQueryDto
): Promise<XpHistoryResponseDto> => {
  const page = query.page ?? DEFAULT_PAGE;
  const size = query.size ?? DEFAULT_SIZE;

  const [rows, totalCount] = await Promise.all([
    xpRepository.findXpHistoryByUserId(userId, page, size),
    xpRepository.countXpHistoryByUserId(userId),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      amount: row.amount,
      reason: row.reason,
      referenceId: row.reference_id,
      referenceType: row.reference_type,
      createdAt: row.created_at.toISOString(),
    })),
    pageInfo: {
      currentPage: page,
      totalPages: Math.max(1, Math.ceil(totalCount / size)),
      totalCount,
    },
  };
};
