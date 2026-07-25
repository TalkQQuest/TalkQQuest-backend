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
                description: true,
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

    // 대화 LLM 응답 생성 시 프롬프트에 넣을 이전 맥락. 최근 limit개를 오래된→최신 순으로 반환한다.
    async findRecentMessages(conversationId: string, limit: number) {
        const rows = await this.prisma.conversation_Messages.findMany({
        where: { conversation_id: conversationId },
        orderBy: { created_at: "desc" },
        take: limit,
        select: { role: true, content: true },
        });
        return rows.reverse();
    }

    // 톤 조정(Requirement 5.4)용 성향/말투 설정.
    async findUserProfileForTone(userId: string) {
        return this.prisma.user_Profiles.findUnique({
        where: { user_id: userId },
        select: { personality_type: true, preferred_style: true },
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
        userId: string,
        conversationId: string,
        status: "completed" | "abandoned",
        finishedAt: Date
    ) {
        return this.prisma.$transaction(async (tx) => {
            // The status predicate makes concurrent/repeated finish requests idempotent:
            // only one transaction can move this conversation out of in_progress.
            const updated = await tx.conversations.updateMany({
                where: { id: conversationId, user_id: userId, status: "in_progress" },
                data: { status, finished_at: finishedAt },
            });

            if (updated.count === 0) return false;

            const existingArchiveItem = await tx.archive_Items.findFirst({
                where: {
                    user_id: userId,
                    item_type: "conversation",
                    reference_id: conversationId,
                },
                select: { id: true },
            });

            if (!existingArchiveItem) {
                await tx.archive_Items.create({
                    data: {
                        user_id: userId,
                        item_type: "conversation",
                        reference_id: conversationId,
                    },
                });
            }

            return true;
        });
    }
}
