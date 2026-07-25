import { BadgeProgressDto } from "./badge-condition.dto";

export interface BadgeItemDto {
  id: string;
  name: string;
  description: string | null;
  iconUrl: string | null;
  isEarned: boolean;
  earnedAt: string | null;
  // 미획득 뱃지만 진행률을 내려준다. 이미 획득한 뱃지는 진행률 표시가 필요 없어 null.
  progress: BadgeProgressDto | null;
}

export interface BadgeListResponseDto {
  badges: BadgeItemDto[];
}

// POST /missions/{missionId}/complete 응답에 실리는, 이번 완료로 새로 획득한 뱃지 목록.
export interface NewlyEarnedBadgeDto {
  id: string;
  name: string;
  description: string | null;
  iconUrl: string | null;
  earnedAt: string;
}
