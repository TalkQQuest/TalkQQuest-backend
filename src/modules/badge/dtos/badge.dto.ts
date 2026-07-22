export interface BadgeItemDto {
  id: string;
  name: string;
  description: string | null;
  iconUrl: string | null;
  earnedAt: string;
}

export interface BadgeListResponseDto {
  badges: BadgeItemDto[];
}
