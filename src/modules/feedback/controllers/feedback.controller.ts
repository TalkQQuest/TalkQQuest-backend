import { Controller, Get, Middlewares, Path, Request, Response, Route, Security, Tags } from "tsoa";
import type { Request as ExpressRequest } from "express";
import { authorizeUser } from "../../../middlewares/auth";
import { success, ApiResponse } from "../../../shared/utils/response";
import { FeedbackDetailResponseDto } from "../dtos/feedback.dto";
import * as feedbackService from "../services/feedback.service";

@Route("feedback")
@Tags("Feedback")
export class FeedbackController extends Controller {
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
