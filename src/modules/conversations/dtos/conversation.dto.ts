import { z } from "zod";

export const CreateConversationSchema = z.object({
    missionId: z.string().uuid({ message: "missionId는 UUID 형식이어야 합니다." }),
    mode: z.enum(["text", "voice"], { message: "mode 값이 올바르지 않습니다." }),
    selectedTopic: z.string().optional(),
    });

    export type CreateConversationDto = z.infer<typeof CreateConversationSchema>;

    // tsoa가 인식할 수 있는 명시적 인터페이스 (Body 타입으로 사용)
    export interface CreateConversationBody {
    missionId: string;
    mode: "text" | "voice";
    selectedTopic?: string;
    }

    export interface CreateConversationResponse {
    conversationId: string;
    missionId: string;
    missionTitle: string;
    mode: string;
    selectedTopic: string | null;
    status: "in_progress";
    startedAt: string;
    /**
     * 서버가 내려주는 첫 안내 메시지. 파트너임을 밝히고 지금부터 어떤 배역으로 대화하는지 알린다.
     * 대화 기록에도 guide 메시지로 저장되므로 GET /conversations/{id}에서 다시 볼 수 있다.
     * (예전엔 서버가 아무것도 안 내려줘 앱이 자체 임시 문구를 띄우고 있었다.)
     */
    openingMessage: string;
    }

    export interface GetConversationGuideResponse {
    conversationId: string;
    guideCards: string[];
    suggestedReplies: string[];
    }

    export interface ConversationMessage {
    id: string;
    role: "user" | "guide" | "system";
    content: string;
    createdAt: string;
    }

    export interface GetConversationResponse {
    conversationId: string;
    missionId: string;
    status: "in_progress" | "completed" | "abandoned";
    startedAt: string;
    finishedAt: string | null;
    /** 대화 소요 시간(분). 아직 종료되지 않았으면 null. */
    durationMinutes: number | null;
    messages: ConversationMessage[];
    }

    export const CreateMessageSchema = z.object({
    role: z.literal("user"),
    content: z.string().min(1, { message: "메시지 내용을 입력해주세요." }).min(2, { message: "대화 내용이 너무 짧습니다." }),
    });

    export type CreateMessageDto = z.infer<typeof CreateMessageSchema>;

    export interface CreateMessageBody {
    role: "user";
    content: string;
    }

    export interface MessageItem {
    id: string;
    role: "user" | "guide" | "system";
    content: string;
    createdAt: string;
    }

    export interface CreateMessageResponse {
    userMessage: MessageItem;
    guideMessage: MessageItem;
    }

    export interface GetConversationSuggestionsResponse {
    suggestions: string[];
    }

    export const FinishConversationSchema = z.object({
    status: z.enum(["completed", "abandoned"], { message: "status 값이 올바르지 않습니다." }),
    });

    export type FinishConversationDto = z.infer<typeof FinishConversationSchema>;

    export interface FinishConversationBody {
    status: "completed" | "abandoned";
    }

    export interface FinishConversationResponse {
    conversationId: string;
    status: "completed" | "abandoned";
    finishedAt: string;
    summary: {
        messageCount: number;
        durationMinutes: number;
    };
}