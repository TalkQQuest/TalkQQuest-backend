// modules/feedback/controllers/feedback.controller.ts
import { Body, Controller, Get, Middlewares, Path, Post, Request, Response, Route, Security, Tags } from "tsoa";
import type { Request as ExpressRequest } from "express";
import { authorizeUser } from "../../../middlewares/auth";
import { validate } from "../../../middlewares/validator";
import { success, ApiResponse } from "../../../shared/utils/response";
import {
  CreateFeedbackRequestDto,
  createFeedbackRequestSchema,
  FeedbackDetailResponseDto,
  FeedbackResponseDto,
  RetryFeedbackResponseDto,
} from "../dtos/feedback.dto";
import * as feedbackService from "../services/feedback.service";

@Route("feedback")
@Tags("Feedback")
export class FeedbackController extends Controller {
  /**
   * @summary 대화 기반 피드백 생성
   */
  @Post()
  @Security("bearerAuth")
  @Middlewares(authorizeUser(), validate(createFeedbackRequestSchema))
  @Response(400, "FEEDBACK_INPUT_TOO_SHORT")
  @Response(401, "UNAUTHORIZED")
  @Response(404, "CONVERSATION_NOT_FOUND")
  @Response(409, "FEEDBACK_NOT_READY")
  public async createFeedback(
    @Body() body: CreateFeedbackRequestDto,
    @Request() req: ExpressRequest
  ): Promise<ApiResponse<FeedbackResponseDto>> {
    const result = await feedbackService.createFeedback(req.user!.id, body);
    return success(result);
  }

  /**
   * @summary 피드백 재시도
   */
  @Post("{feedbackId}/retry")
  @Security("bearerAuth")
  @Middlewares(authorizeUser())
  @Response(401, "UNAUTHORIZED")
  @Response(404, "FEEDBACK_NOT_FOUND")
  @Response(409, "FEEDBACK_NOT_READY")
  public async retryFeedback(
    @Path() feedbackId: string,
    @Request() req: ExpressRequest
  ): Promise<ApiResponse<RetryFeedbackResponseDto>> {
    const result = await feedbackService.retryFeedback(req.user!.id, feedbackId);
    return success(result, "피드백을 다시 생성하고 있습니다.");
  }

  /**
   * @summary 피드백 상세 조회
   */
  @Get("{feedbackId}")
  @Security("bearerAuth")
  @Middlewares(authorizeUser())
  @Response(401, "UNAUTHORIZED")
  @Response(404, "FEEDBACK_NOT_FOUND")
  public async getFeedbackDetail(
    @Request() req: ExpressRequest,
    @Path() feedbackId: string
  ): Promise<ApiResponse<FeedbackDetailResponseDto>> {
    const result = await feedbackService.getFeedbackDetail(req.user!.id, feedbackId);
    return success(result);
  }
}
