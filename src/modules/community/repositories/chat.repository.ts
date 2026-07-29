// modules/community/repositories/chat.repository.ts
import { prisma } from "../../../config/database";

export const createTextMessage = (communityId: string, userId: string, content: string) =>
    prisma.chat_Messages.create({
        data: { community_id: communityId, user_id: userId, content, type: "text" },
        include: { user: { select: { name: true } } },
    });

// 시스템 메시지("OOO님이 입장했습니다")는 특정 발화자가 없다 (user_id: null).
export const createSystemMessage = (communityId: string, content: string) =>
    prisma.chat_Messages.create({
        data: { community_id: communityId, content, type: "system" },
    });

// 커서(마지막으로 받은 메시지 id) 기준 이전 메시지를 최신순으로 size+1건 가져와
// 다음 페이지 존재 여부를 판단한다.
export const findMessagesBeforeCursor = async (communityId: string, cursor: string | undefined, size: number) => {
    const cursorRow = cursor
        ? await prisma.chat_Messages.findUnique({ where: { id: cursor }, select: { created_at: true } })
        : null;

    return prisma.chat_Messages.findMany({
        where: {
            community_id: communityId,
            ...(cursorRow && { created_at: { lt: cursorRow.created_at } }),
        },
        include: { user: { select: { name: true } } },
        orderBy: { created_at: "desc" },
        take: size,
    });
};
