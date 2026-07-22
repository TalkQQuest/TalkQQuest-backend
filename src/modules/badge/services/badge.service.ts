import { findUserBadgesByUserId } from "../repositories/badge.repository";
import { BadgeListResponseDto } from "../dtos/badge.dto";

// 배지를 실제로 부여하는 자동 획득 로직(조건 판정)은 이번 범위에서 제외한다.
// User_Badges 데이터는 당분간 수동으로 넣어두고, 이 API는 조회만 담당한다.
export const getMyBadges = async (userId: string): Promise<BadgeListResponseDto> => {
  const userBadges = await findUserBadgesByUserId(userId);

  return {
    badges: userBadges.map((ub) => ({
      id: ub.badge.id,
      name: ub.badge.name,
      description: ub.badge.description,
      iconUrl: ub.badge.icon_url,
      earnedAt: ub.earned_at.toISOString(),
    })),
  };
};
