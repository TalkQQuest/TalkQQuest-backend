import { Body, Controller, Middlewares, Path, Post, Request, Response, Route, Security, Tags } from "tsoa";
import type { Request as ExpressRequest } from "express";
import { authorizeUser } from "../../../middlewares/auth";
import { validate } from "../../../middlewares/validator";
import { success, ApiResponse } from "../../../shared/utils/response";
import {
  completeConversationRequestSchema,
  CompleteConversationRequestDto,
  CompleteConversationResponseDto,
} from "../dtos/mission-completion.dto";
import * as missionCompletionService from "../services/mission-completion.service";

@Route("conversations")
@Tags("Conversation")
export class MissionCompletionController extends Controller {
  /**
   * @summary 미션 완료 처리
   */
  @Post("{conversationId}/complete")
  @Security("bearerAuth")
  @Middlewares(authorizeUser(), validate(completeConversationRequestSchema))
  @Response(400, "VALIDATION_ERROR")
  @Response(401, "UNAUTHORIZED")
  @Response(404, "MISSION_NOT_FOUND")
  public async completeConversation(
    @Request() req: ExpressRequest,
    @Path() conversationId: string,
    @Body() body: CompleteConversationRequestDto
  ): Promise<ApiResponse<CompleteConversationResponseDto>> {
    const result = await missionCompletionService.completeConversation(
      req.user!.id,
      conversationId,
      body
    );
    return success(result, "미션을 완료했습니다.");
  }
}