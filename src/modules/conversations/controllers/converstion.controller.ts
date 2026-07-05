import {
    Body,
    Controller,
    Get,
    Path,
    Post,
    Request,
    Response,
    Route,
    Security,
    Tags,
} from "tsoa";
import { success, failure, ApiResponse } from "../../../shared/utils/response";
import {
    CreateConversationBody,
    CreateConversationResponse,
    GetConversationGuideResponse,
    GetConversationResponse,
    CreateMessageBody,
    CreateMessageResponse,
    GetConversationSuggestionsResponse,
    FinishConversationBody,
    FinishConversationResponse,
} from "../dtos/conversation.dto";
import { ConversationService } from "../services/conversation.service";
import { ConversationRepository } from "../repositories/conversation.repository";
import { ConversationError } from "../errors/conversation.error";
import {
    CreateConversationSchema,
    CreateMessageSchema,
    FinishConversationSchema,
} from "../dtos/conversation.dto";
import { prisma } from "../../../config/database";

const conversationService = new ConversationService(
    new ConversationRepository(prisma)
    );

    @Route("conversations")
    @Tags("Conversation")
    export class ConversationController extends Controller {
    /**
     * @summary 대화 세션 생성
     */
    @Post()
    @Security("jwt")
    @Response(400, "VALIDATION_ERROR")
    @Response(401, "UNAUTHORIZED")
    @Response(404, "MISSION_NOT_FOUND")
    public async createConversation(
        @Body() body: CreateConversationBody,
        @Request() req: Express.Request & { user: { id: string } }
    ): Promise<ApiResponse<CreateConversationResponse | null>> {
        const parsed = CreateConversationSchema.safeParse(body);
        if (!parsed.success) {
        this.setStatus(400);
        return failure("VALIDATION_ERROR", parsed.error.errors[0].message);
        }
        try {
        const result = await conversationService.createConversation(req.user.id, parsed.data);
        return success(result);
        } catch (err) {
        if (err instanceof ConversationError) {
            this.setStatus(err.statusCode);
            return failure(err.errorCode, err.message);
        }
        this.setStatus(500);
        return failure("SERVER_ERROR", "서버 내부 오류가 발생했습니다.");
        }
    }

    /**
     * @summary 대화 내역 조회
     */
    @Get("{conversationId}")
    @Security("jwt")
    @Response(401, "UNAUTHORIZED")
    @Response(404, "CONVERSATION_NOT_FOUND")
    public async getConversation(
        @Path() conversationId: string,
        @Request() req: Express.Request & { user: { id: string } }
    ): Promise<ApiResponse<GetConversationResponse | null>> {
        try {
        const result = await conversationService.getConversation(req.user.id, conversationId);
        return success(result);
        } catch (err) {
        if (err instanceof ConversationError) {
            this.setStatus(err.statusCode);
            return failure(err.errorCode, err.message);
        }
        this.setStatus(500);
        return failure("SERVER_ERROR", "서버 내부 오류가 발생했습니다.");
        }
    }

    /**
     * @summary 주제 도움 / 추천 문장 조회
     */
    @Get("{conversationId}/guide")
    @Security("jwt")
    @Response(401, "UNAUTHORIZED")
    @Response(404, "CONVERSATION_NOT_FOUND")
    public async getConversationGuide(
        @Path() conversationId: string,
        @Request() req: Express.Request & { user: { id: string } }
    ): Promise<ApiResponse<GetConversationGuideResponse | null>> {
        try {
        const result = await conversationService.getConversationGuide(req.user.id, conversationId);
        return success(result);
        } catch (err) {
        if (err instanceof ConversationError) {
            this.setStatus(err.statusCode);
            return failure(err.errorCode, err.message);
        }
        this.setStatus(500);
        return failure("SERVER_ERROR", "서버 내부 오류가 발생했습니다.");
        }
    }

    /**
     * @summary 메시지 저장 / 응답 생성
     */
    @Post("{conversationId}/messages")
    @Security("jwt")
    @Response(400, "VALIDATION_ERROR")
    @Response(401, "UNAUTHORIZED")
    @Response(404, "CONVERSATION_NOT_FOUND")
    public async createMessage(
        @Path() conversationId: string,
        @Body() body: CreateMessageBody,
        @Request() req: Express.Request & { user: { id: string } }
    ): Promise<ApiResponse<CreateMessageResponse | null>> {
        const parsed = CreateMessageSchema.safeParse(body);
        if (!parsed.success) {
        this.setStatus(400);
        return failure("VALIDATION_ERROR", parsed.error.errors[0].message);
        }
        try {
        const result = await conversationService.createMessage(
            req.user.id, conversationId, parsed.data
        );
        return success(result);
        } catch (err) {
        if (err instanceof ConversationError) {
            this.setStatus(err.statusCode);
            return failure(err.errorCode, err.message);
        }
        this.setStatus(500);
        return failure("SERVER_ERROR", "서버 내부 오류가 발생했습니다.");
        }
    }

    /**
     * @summary 후속 질문 / 표현 추천 조회
     */
    @Get("{conversationId}/suggestions")
    @Security("jwt")
    @Response(401, "UNAUTHORIZED")
    @Response(404, "CONVERSATION_NOT_FOUND")
    public async getConversationSuggestions(
        @Path() conversationId: string,
        @Request() req: Express.Request & { user: { id: string } }
    ): Promise<ApiResponse<GetConversationSuggestionsResponse | null>> {
        try {
        const result = await conversationService.getConversationSuggestions(
            req.user.id, conversationId
        );
        return success(result);
        } catch (err) {
        if (err instanceof ConversationError) {
            this.setStatus(err.statusCode);
            return failure(err.errorCode, err.message);
        }
        this.setStatus(500);
        return failure("SERVER_ERROR", "서버 내부 오류가 발생했습니다.");
        }
    }

    /**
     * @summary 대화 종료
     */
    @Post("{conversationId}/finish")
    @Security("jwt")
    @Response(400, "VALIDATION_ERROR")
    @Response(401, "UNAUTHORIZED")
    @Response(404, "CONVERSATION_NOT_FOUND")
    public async finishConversation(
        @Path() conversationId: string,
        @Body() body: FinishConversationBody,
        @Request() req: Express.Request & { user: { id: string } }
    ): Promise<ApiResponse<FinishConversationResponse | null>> {
        const parsed = FinishConversationSchema.safeParse(body);
        if (!parsed.success) {
        this.setStatus(400);
        return failure("VALIDATION_ERROR", parsed.error.errors[0].message);
        }
        try {
        const result = await conversationService.finishConversation(
            req.user.id, conversationId, parsed.data
        );
        return success(result);
        } catch (err) {
        if (err instanceof ConversationError) {
            this.setStatus(err.statusCode);
            return failure(err.errorCode, err.message);
        }
        this.setStatus(500);
        return failure("SERVER_ERROR", "서버 내부 오류가 발생했습니다.");
        }
    }
}