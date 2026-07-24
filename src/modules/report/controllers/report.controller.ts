// modules/report/controllers/report.controller.ts
import { Controller, Get, Middlewares, Request, Response, Route, Security, Tags } from "tsoa";
import type { Request as ExpressRequest } from "express";
import { authorizeUser } from "../../../middlewares/auth";
import { success, ApiResponse } from "../../../shared/utils/response";
import { WeeklyCompareResponseDto } from "../dtos/report.dto";
import * as reportService from "../services/report.service";

@Route("reports")
@Tags("Report")
export class ReportController extends Controller {
  /**
   * @summary 주간 비교 리포트 조회 (이번 주 vs 지난 주)
   */
  @Get("weekly-compare")
  @Security("bearerAuth")
  @Middlewares(authorizeUser())
  @Response(401, "UNAUTHORIZED")
  public async getWeeklyCompareReport(
    @Request() req: ExpressRequest
  ): Promise<ApiResponse<WeeklyCompareResponseDto>> {
    const result = await reportService.getWeeklyCompareReport(req.user!.id);
    return success(result);
  }
}
