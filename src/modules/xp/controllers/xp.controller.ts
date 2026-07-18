// modules/xp/controllers/xp.controller.ts
import { Controller, Get, Middlewares, Request, Route, Security, Tags } from "tsoa";
import type { Request as ExpressRequest } from "express";
import { authorizeUser } from "../../../middlewares/auth";
import { ValidationError } from "../../../shared/errors/common.error";
import { success, ApiResponse } from "../../../shared/utils/response";
import {
  getXpHistoryQuerySchema,
  XpHistoryResponseDto,
  XpSummaryResponseDto,
} from "../dtos/xp.dto";
import * as xpService from "../services/xp.service";

@Route("xp")
@Tags("XP")
export class XpController extends Controller {
  /**
   * @summary XP/레벨 요약 조회
   */
  @Get("summary")
  @Security("bearerAuth")
  @Middlewares(authorizeUser())
  public async getXpSummary(
    @Request() req: ExpressRequest
  ): Promise<ApiResponse<XpSummaryResponseDto>> {
    const result = await xpService.getXpSummary(req.user!.id);
    return success(result);
  }

  /**
   * @summary XP 획득/차감 내역 조회
   */
  @Get("history")
  @Security("bearerAuth")
  @Middlewares(authorizeUser())
  public async getXpHistory(
    @Request() req: ExpressRequest
  ): Promise<ApiResponse<XpHistoryResponseDto>> {
    const parsed = getXpHistoryQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError("잘못된 조회 조건입니다.", parsed.error.issues);
    }

    const result = await xpService.getXpHistory(req.user!.id, parsed.data);
    return success(result);
  }
}
