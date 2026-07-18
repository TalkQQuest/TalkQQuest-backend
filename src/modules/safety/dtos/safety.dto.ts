export interface BlockedUserItem {
    id: string;
    blockedUserId: string;
    nickname: string | null;
    avatarUrl: string | null;
    createdAt: string;
}

export interface BlockedUsersResponseDto {
    blockedUsers: BlockedUserItem[];
}

export interface BlockUserRequestDto {
    blockedUserId: string;
}

export interface UnblockUserRequestDto {
    blockedUserId: string;
}