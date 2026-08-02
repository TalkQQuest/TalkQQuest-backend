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
import { buildOpeningMessage } from "../dtos/conversation.constants";
import { generateGuideReply, MAX_HISTORY_MESSAGES } from "./conversation-guide.service";
import { generateRoleSetup } from "./conversation-role.service";
import { generateSuggestions } from "./conversation-suggestion.service";
import {
    buildIdentityResponse,
    matchesIdentityQuestion,
} from "./conversation-guard.service";
import {
    advanceFlow,
    generatePlaybook,
    matchResponseRules,
    parseStoredPlaybook,
} from "../../mission/services/playbook.service";
import { embedQuery } from "../../../shared/ai";
import { durationMinutes } from "../../../shared/utils/date";

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

        // 배역과 "사용자가 할 일"을 이 시점에 한 번 정해 저장한다. 매 턴 다시 만들지 않으므로
        // 대화 내내 일관되고, 생성이 실패해도(null) 미션 제목 기반으로 그대로 진행된다.
        // 플레이북은 미션 단위라 처음 대화를 시작하는 사용자만 생성 비용을 치른다.
        // 배역 설정과 독립이라 병렬로 처리해 세션 생성 지연을 줄인다.
        const [roleSetup] = await Promise.all([
        generateRoleSetup(mission.title, mission.description),
        this.ensureMissionPlaybook(mission),
        ]);
        const conversation = await this.conversationRepository.createConversation(userId, dto, roleSetup);

        // 첫 안내를 guide 메시지로 저장해 둔다. 앱이 응답에서 바로 띄울 수도 있고,
        // 나중에 대화 기록을 다시 열었을 때도 같은 안내가 남아 있어야 하기 때문이다.
        const openingMessage = buildOpeningMessage(mission.title);
        await this.conversationRepository.createMessage(conversation.id, "guide", openingMessage);

        return {
        conversationId: conversation.id,
        missionId: mission.id,
        missionTitle: mission.title,
        mode: conversation.mode ?? dto.mode,
        selectedTopic: conversation.selected_topic,
        status: "in_progress",
        startedAt: conversation.started_at.toISOString(),
        openingMessage,
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
        durationMinutes: durationMinutes(conversation.started_at, conversation.finished_at),
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

        const guideContent = await this.buildGuideContent(conversation, profile, history, dto.content);

        const guideMsg = await this.conversationRepository.createMessage(
        conversationId, "guide", guideContent
        );

        return {
        userMessage: { id: userMsg.id, role: "user", content: userMsg.content, createdAt: userMsg.created_at.toISOString() },
        guideMessage: { id: guideMsg.id, role: "guide", content: guideMsg.content, createdAt: guideMsg.created_at.toISOString() },
        };
    }

    // 미션에 플레이북이 없으면 이 시점에 만들어 캐시한다(미션당 1회, 이후 모든 사용자가 재사용).
    // 생성에 실패해도 대화 시작을 막지 않는다 — 플레이북 없이도 기존대로 동작한다.
    private async ensureMissionPlaybook(mission: {
        id: string;
        title: string;
        description: string | null;
        dialogue_playbook: unknown;
    }): Promise<void> {
        if (parseStoredPlaybook(mission.dialogue_playbook)) return;

        const playbook = await generatePlaybook(mission.title, mission.description);
        if (!playbook) return;

        await this.conversationRepository.saveMissionPlaybook(mission.id, playbook);
    }

    // 이 대화에서 지금까지 오간 사용자 발화 수. advanceFlow가 단계별 턴 상한을 계산하는 데 쓴다.
    private countUserTurns(history: { role: string; content: string }[]): number {
        return history.filter((m) => m.role === "user").length;
    }

    // 이번 턴의 상대 답변을 정한다.
    //  1) 정체 질문이면 LLM을 거치지 않고 고정 문구로 답한다(가드레일).
    //  2) 그 외에는 LLM 생성 → 규칙 검증 통과분만 사용.
    //  3) 생성·검증이 모두 실패하면 대화가 끊기지 않도록 템플릿으로 폴백한다(5.5).
    private async buildGuideContent(
        conversation: {
            id: string;
            persona: string | null;
            user_task: string | null;
            flow_step: number;
            mission: { title: string; description: string | null; dialogue_playbook?: unknown };
        },
        profile: { personality_type: string | null; preferred_style: string | null } | null,
        history: { role: string; content: string }[],
        latestUserMessage: string
    ): Promise<string> {
        // 정체 질문에 LLM이 매번 다른 자기소개를 지어내고 그 뒤로 배역이 굳던 문제 때문에,
        // 이 경우만 서버가 직접 답한다. 일관성이 보장되고 호출 비용·지연도 없다.
        if (matchesIdentityQuestion(latestUserMessage)) {
        return buildIdentityResponse(conversation.persona);
        }

        const playbook = parseStoredPlaybook(conversation.mission.dialogue_playbook);

        // 사용자 발화를 **한 번만** 임베딩해 상황 규칙 매칭과 흐름 단계 판정에 함께 쓴다.
        // 각자 임베딩하면 같은 문장으로 API를 두 번 부르게 된다.
        const queryVector = playbook ? await embedQuery(latestUserMessage, "대화 플레이북") : null;

        // 상황 규칙은 이번 발화와 관련 있는 것만 골라 넣는다.
        const matchedRules = playbook && queryVector ? matchResponseRules(playbook, queryVector) : [];

        // 흐름은 사용자가 현재 단계의 통과 조건을 충족했을 때만 다음으로 넘어간다.
        const totalUserTurns = this.countUserTurns(history);
        const progress = advanceFlow(playbook, conversation.flow_step, totalUserTurns, queryVector);
        if (progress.advanced) {
        await this.conversationRepository.updateFlowStep(conversation.id, progress.stepIndex);
        }

        const llmReply = await generateGuideReply({
        missionTitle: conversation.mission.title,
        missionDescription: conversation.mission.description,
        persona: conversation.persona,
        userTask: conversation.user_task,
        flowStep: progress.step,
        matchedRules,
        personality: profile?.personality_type ?? null,
        preferredStyle: profile?.preferred_style ?? null,
        history: history.filter(
            (m): m is { role: "user" | "guide"; content: string } => m.role !== "system"
        ),
        latestUserMessage,
        });

        return (
        llmReply ?? MOCK_GUIDE_RESPONSES[Math.floor(Math.random() * MOCK_GUIDE_RESPONSES.length)]
        );
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

        // 지금 대화 맥락을 보고 생성한다. 예전엔 미션의 question 항목이나 하드코딩 목업을
        // 그대로 돌려줘 대화와 무관한 추천이 나갔다(카페 주문 중 "평소에도 산책 자주 하세요?").
        const history = await this.conversationRepository.findRecentMessages(
        conversationId,
        MAX_HISTORY_MESSAGES
        );

        const generated = await generateSuggestions({
        missionTitle: conversation.mission.title,
        missionDescription: conversation.mission.description,
        history: history.filter(
            (m): m is { role: "user" | "guide"; content: string } => m.role !== "system"
        ),
        });

        // LLM이 실패했을 때만 템플릿으로 폴백한다(대화가 끊기지 않도록).
        const suggestions =
        generated ?? MOCK_SUGGESTIONS[Math.floor(Math.random() * MOCK_SUGGESTIONS.length)];

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
