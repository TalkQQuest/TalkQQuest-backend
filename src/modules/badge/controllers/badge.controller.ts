import { Controller, Get, Middlewares, Request, Response, Route, Security, Tags } from "tsoa";
import type { Request as ExpressRequest } from "express";
import { authorizeUser } from "../../../middlewares/auth";
import { success, ApiResponse } from "../../../shared/utils/response";
import { BadgeListResponseDto } from "../dtos/badge.dto";
import * as badgeService from "../services/badge.service";

@Route("badges")
@Tags("User")
export class BadgeController extends Controller {
  /**
   * @summary 보유 배지 목록 조회
   */
  @Get("me")
  @Security("bearerAuth")
  @Middlewares(authorizeUser())
  @Response(401, "UNAUTHORIZED")
  public async getMyBadges(@Request() req: ExpressRequest): Promise<ApiResponse<BadgeListResponseDto>> {
    const result = await badgeService.getMyBadges(req.user!.id);
    return success(result);
  }
}
