// modules/community/services/chat.service.ts
import * as chatRepository from "../repositories/chat.repository";
import * as communityRepository from "../repositories/community.repository";
import { CommunityNotFoundError } from "../errors/community.error";
import { ForbiddenError } from "../../../shared/errors/common.error";
import { ChatMessageItemDto, ListChatMessagesQueryDto, ListChatMessagesResponseDto } from "../dtos/chat.dto";

const DEFAULT_SIZE = 30;

export const listMessages = async (
    userId: string,
    communityId: string,
    query: ListChatMessagesQueryDto
): Promise<ListChatMessagesResponseDto> => {
    const community = await communityRepository.findCommunityById(communityId);
    if (!community) throw new CommunityNotFoundError();

    const member = await communityRepository.findMember(communityId, userId);
    if (!member) throw new ForbiddenError("이 모임에 참여 중이 아닙니다.");

    const size = query.size ?? DEFAULT_SIZE;
    const rows = await chatRepository.findMessagesBeforeCursor(communityId, query.cursor, size + 1);

    const hasMore = rows.length > size;
    const page = hasMore ? rows.slice(0, size) : rows;

    const items: ChatMessageItemDto[] = page.map((row) => ({
        id: row.id,
        userId: row.user_id,
        userNickname: row.user?.name ?? null,
        content: row.content,
        type: row.type,
        createdAt: row.created_at.toISOString(),
    }));

    return { items, nextCursor: hasMore ? page[page.length - 1].id : null };
};
