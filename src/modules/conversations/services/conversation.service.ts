import { ConversationRepository } from "../repositories/conversation.repository";
import {
    CreateConversationDto,
    CreateConversationResponse,
    GetConversationGuideResponse,
    GetConversationResponse,
    CreateMessageDto,
    CreateMessageResponse,
    GetConversationSuggestionsResponse,
    FinishConversationDto,
    FinishConversationResponse,
} from "../dtos/conversation.dto";
import { ConversationError } from "../errors/conversation.error";
import { generateGuideReply, MAX_HISTORY_MESSAGES } from "./conversation-llm.service";

// LLM이 실패(키 없음/오류/재시도까지 실패)했을 때 대화가 끊기지 않도록 쓰는 템플릿 폴백 (Requirement 5.5).
const MOCK_GUIDE_RESPONSES = [
    "맞아요! 이런 날엔 산책하기 좋을 것 같아요.",
    "그렇군요! 저도 비슷한 생각이에요.",
    "흥미롭네요, 더 얘기해주세요!",
    "좋은 생각이에요. 어떻게 그런 생각을 하게 됐나요?",
    "정말요? 저도 그런 경험이 있어요.",
    ];

    const MOCK_SUGGESTIONS = [
    ["평소에도 산책 자주 하세요?", "주말엔 보통 뭐 하세요?"],
    ["요즘 관심 있는 게 있으세요?", "그 얘기 더 해주실 수 있어요?"],
    ["어떤 계기로 그렇게 생각하게 됐어요?", "그때 기분이 어땠어요?"],
    ["비슷한 경험 있으세요?", "그래서 어떻게 됐어요?"],
    ];

    export class ConversationService {
    constructor(private readonly conversationRepository: ConversationRepository) {}

    async createConversation(
        userId: string,
        dto: CreateConversationDto
    ): Promise<CreateConversationResponse> {
        const mission = await this.conversationRepository.findMissionById(dto.missionId);
        if (!mission) throw ConversationError.missionNotFound();

        const conversation = await this.conversationRepository.createConversation(userId, dto);

        return {
        conversationId: conversation.id,
        missionId: mission.id,
        missionTitle: mission.title,
        mode: conversation.mode ?? dto.mode,
        selectedTopic: conversation.selected_topic,
        status: "in_progress",
        startedAt: conversation.started_at.toISOString(),
        };
    }

    async getConversation(
        userId: string,
        conversationId: string
    ): Promise<GetConversationResponse> {
        const conversation = await this.conversationRepository.findConversationWithMessages(
        conversationId,
        userId
        );
        if (!conversation) throw ConversationError.conversationNotFound();

        return {
        conversationId: conversation.id,
        missionId: conversation.mission_id,
        status: conversation.status,
        startedAt: conversation.started_at.toISOString(),
        finishedAt: conversation.finished_at ? conversation.finished_at.toISOString() : null,
        messages: conversation.messages.map((msg) => ({
            id: msg.id,
            role: msg.role,
            content: msg.content,
            createdAt: msg.created_at.toISOString(),
        })),
        };
    }

    async getConversationGuide(
        userId: string,
        conversationId: string
    ): Promise<GetConversationGuideResponse> {
        const conversation = await this.conversationRepository.findConversationById(
        conversationId,
        userId
        );
        if (!conversation) throw ConversationError.conversationNotFound();

        const prepItems = conversation.mission.prep_items;
        const guideCards = prepItems
        .filter((item) => item.type === "tip" || item.type === "starter")
        .map((item) => item.content);
        const suggestedReplies = prepItems
        .filter((item) => item.type === "question")
        .map((item) => item.content);

        return {
        conversationId,
        guideCards: guideCards.length > 0 ? guideCards : ["상대방의 답변에 짧게 리액션을 해보세요."],
        suggestedReplies: suggestedReplies.length > 0 ? suggestedReplies : ["그렇군요! 저도 그렇게 생각해요.", "오늘 하루 어떠셨어요?"],
        };
    }

    async createMessage(
        userId: string,
        conversationId: string,
        dto: CreateMessageDto
    ): Promise<CreateMessageResponse> {
        const conversation = await this.conversationRepository.findConversationById(
        conversationId,
        userId
        );
        if (!conversation) throw ConversationError.conversationNotFound();
        if (dto.content.trim().length < 2) throw ConversationError.feedbackInputTooShort();

        // LLM 프롬프트용 이전 맥락(5.3)과 톤 설정(5.4)을 새 메시지 저장 전에 확보한다.
        const [history, profile] = await Promise.all([
        this.conversationRepository.findRecentMessages(conversationId, MAX_HISTORY_MESSAGES),
        this.conversationRepository.findUserProfileForTone(userId),
        ]);

        const userMsg = await this.conversationRepository.createMessage(
        conversationId, "user", dto.content
        );

        // 실제 LLM 응답을 우선 생성하고, 실패하면 템플릿으로 폴백한다(5.5).
        const llmReply = await generateGuideReply({
        missionTitle: conversation.mission.title,
        missionDescription: conversation.mission.description,
        personality: profile?.personality_type ?? null,
        preferredStyle: profile?.preferred_style ?? null,
        history: history.filter(
            (m): m is { role: "user" | "guide"; content: string } => m.role !== "system"
        ),
        latestUserMessage: dto.content,
        });
        const guideContent =
        llmReply ??
        MOCK_GUIDE_RESPONSES[Math.floor(Math.random() * MOCK_GUIDE_RESPONSES.length)];

        const guideMsg = await this.conversationRepository.createMessage(
        conversationId, "guide", guideContent
        );

        return {
        userMessage: { id: userMsg.id, role: "user", content: userMsg.content, createdAt: userMsg.created_at.toISOString() },
        guideMessage: { id: guideMsg.id, role: "guide", content: guideMsg.content, createdAt: guideMsg.created_at.toISOString() },
        };
    }

    async getConversationSuggestions(
        userId: string,
        conversationId: string
    ): Promise<GetConversationSuggestionsResponse> {
        const conversation = await this.conversationRepository.findConversationById(
        conversationId,
        userId
        );
        if (!conversation) throw ConversationError.conversationNotFound();

        const prepItems = conversation.mission.prep_items;
        const questionItems = prepItems
        .filter((item) => item.type === "question")
        .map((item) => item.content);

        const suggestions =
        questionItems.length > 0
            ? questionItems
            : MOCK_SUGGESTIONS[Math.floor(Math.random() * MOCK_SUGGESTIONS.length)];

        return { suggestions };
    }

    async finishConversation(
        userId: string,
        conversationId: string,
        dto: FinishConversationDto
    ): Promise<FinishConversationResponse> {
        const conversation = await this.conversationRepository.findConversationWithMessages(
        conversationId,
        userId
        );
        if (!conversation) throw ConversationError.conversationNotFound();

        // 이미 종료된 대화 체크
        if (conversation.status !== "in_progress") {
        throw ConversationError.alreadyFinished();
        }

        const finishedAt = new Date();
        const finished = await this.conversationRepository.finishConversation(
        userId,
        conversationId,
        dto.status,
        finishedAt
        );
        if (!finished) throw ConversationError.alreadyFinished();

        // 소요 시간 계산 (분 단위, 소수점 버림)
        const durationMinutes = Math.floor(
        (finishedAt.getTime() - conversation.started_at.getTime()) / 1000 / 60
        );

        return {
        conversationId,
        status: dto.status,
        finishedAt: finishedAt.toISOString(),
        summary: {
            messageCount: conversation.messages.length,
            durationMinutes,
        },
        };
    }
}
