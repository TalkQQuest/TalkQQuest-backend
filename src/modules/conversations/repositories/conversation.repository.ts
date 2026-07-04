import { PrismaClient } from "@prisma/client";
import { CreateConversationDto } from "../dtos/conversation.dto";

export class ConversationRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async findMissionById(missionId: string) {
        return this.prisma.missions.findUnique({
        where: { id: missionId },
        select: {
            id: true,
            title: true,
            preparation_tip: true,
            prep_items: {
            select: { type: true, content: true, order_index: true },
            orderBy: { order_index: "asc" },
            },
        },
        });
    }

    async createConversation(userId: string, dto: CreateConversationDto) {
        return this.prisma.conversations.create({
        data: {
            user_id: userId,
            mission_id: dto.missionId,
            mode: dto.mode,
            selected_topic: dto.selectedTopic ?? null,
            status: "in_progress",
            started_at: new Date(),
        },
        });
    }

    async findConversationById(conversationId: string, userId: string) {
        return this.prisma.conversations.findFirst({
        where: { id: conversationId, user_id: userId },
        include: {
            mission: {
            select: {
                id: true,
                title: true,
                preparation_tip: true,
                prep_items: {
                select: { type: true, content: true, order_index: true },
                orderBy: { order_index: "asc" },
                },
            },
            },
        },
        });
    }

    async findConversationWithMessages(conversationId: string, userId: string) {
        return this.prisma.conversations.findFirst({
        where: { id: conversationId, user_id: userId },
        include: {
            messages: {
            orderBy: { created_at: "asc" },
            select: {
                id: true,
                role: true,
                content: true,
                created_at: true,
            },
            },
        },
        });
    }

    async createMessage(
        conversationId: string,
        role: "user" | "guide" | "system",
        content: string
    ) {
        return this.prisma.conversation_Messages.create({
        data: { conversation_id: conversationId, role, content },
        });
    }

    async finishConversation(
        conversationId: string,
        status: "completed" | "abandoned",
        finishedAt: Date
    ) {
        return this.prisma.conversations.update({
        where: { id: conversationId },
        data: { status, finished_at: finishedAt },
        include: {
            messages: { select: { id: true } },
        },
        });
    }
}