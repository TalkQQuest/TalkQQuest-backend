import {
    findBlockedUsersByUserId,
    findUserById,
    findBlockRecord,
    createBlockRecord,
    deleteBlockRecord,
} from "../repositories/safety.repository";
import { BlockedUsersResponseDto, BlockUserRequestDto, UnblockUserRequestDto } from "../dtos/safety.dto";
import { NotFoundError, DuplicatedError } from "../../../shared/errors/common.error";

export const getBlockedUsers = async (userId: string): Promise<BlockedUsersResponseDto> => {
    const blocked = await findBlockedUsersByUserId(userId);

    return {
        blockedUsers: blocked.map((b) => ({
        id: b.id,
        blockedUserId: b.blocked_user_id,
        nickname: b.blocked_user.user_profile?.nickname ?? null,
        avatarUrl: b.blocked_user.user_profile?.avatar_url ?? null,
        createdAt: b.created_at.toISOString(),
        })),
    };
};

export const blockUser = async (userId: string, dto: BlockUserRequestDto): Promise<void> => {
    const targetUser = await findUserById(dto.blockedUserId);
    if (!targetUser) {
        throw new NotFoundError("존재하지 않는 유저입니다.");
    }

    const existing = await findBlockRecord(userId, dto.blockedUserId);
    if (existing) {
        throw new DuplicatedError("이미 차단한 유저입니다.");
    }

    await createBlockRecord(userId, dto.blockedUserId);
};

export const unblockUser = async (userId: string, dto: UnblockUserRequestDto): Promise<void> => {
    const existing = await findBlockRecord(userId, dto.blockedUserId);
    if (!existing) {
        throw new NotFoundError("차단 내역이 없습니다.");
    }

    await deleteBlockRecord(userId, dto.blockedUserId);
};