import { z } from "zod";

export type ChatMessageType = "text" | "system";

// GET /communities/{communityId}/messages
export interface ListChatMessagesQueryDto {
    cursor?: string;
    size?: number;
}

export const listChatMessagesQuerySchema = z.object({
    cursor: z.string().uuid().optional(),
    size: z.coerce.number().int().positive().max(100).optional(),
}) satisfies z.ZodType<ListChatMessagesQueryDto>;

export interface ChatMessageItemDto {
    id: string;
    userId: string | null;
    userNickname: string | null;
    content: string;
    type: ChatMessageType;
    createdAt: string;
}

export interface ListChatMessagesResponseDto {
    items: ChatMessageItemDto[];
    nextCursor: string | null;
}
