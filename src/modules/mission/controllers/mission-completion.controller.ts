import { Body, Controller, Middlewares, Path, Post, Request, Response, Route, Security, Tags } from "tsoa";
import type { Request as ExpressRequest } from "express";
import { authorizeUser } from "../../../middlewares/auth";
import { validate } from "../../../middlewares/validator";
import { success, ApiResponse } from "../../../shared/utils/response";
import {
  completeMissionRequestSchema,
  CompleteMissionRequestDto,
  CompleteMissionResponseDto,
} from "../dtos/mission-completion.dto";
import * as missionCompletionService from "../services/mission-completion.service";

@Route("missions")
@Tags("Mission")
export class MissionCompletionController extends Controller {
  /**
   * @summary 미션 완료 처리
   */
  @Post("{missionId}/complete")
  @Security("bearerAuth")
  @Middlewares(authorizeUser(), validate(completeMissionRequestSchema))
  @Response(400, "VALIDATION_ERROR")
  @Response(401, "UNAUTHORIZED")
  @Response(404, "MISSION_NOT_FOUND")
  public async completeConversation(
    @Request() req: ExpressRequest,
    @Path() missionId: string,
    @Body() body: CompleteMissionRequestDto
  ): Promise<ApiResponse<CompleteMissionResponseDto>> {
    const result = await missionCompletionService.completeMission(
      req.user!.id,
      missionId,
      body
    );
    return success(result, "미션을 완료했습니다.");
  }
}