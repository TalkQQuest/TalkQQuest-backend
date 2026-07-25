import { Body, Controller, Delete, Get, Middlewares, Path, Post, Query, Request, Response, Route, Security, Tags } from "tsoa";
import type { Request as ExpressRequest } from "express";
import { authorizeUser } from "../../../middlewares/auth";
import { validate } from "../../../middlewares/validator";
import { ValidationError } from "../../../shared/errors/common.error";
import { success, ApiResponse } from "../../../shared/utils/response";
import {
  DeleteReportResponseDto,
  GrowthReportDto,
  listReportsQuerySchema,
  ListReportsResponseDto,
  ReportDetailResponseDto,
  SaveReportRequestDto,
  saveReportRequestSchema,
  SaveReportResponseDto,
  WeeklyCompareReportDto,
} from "../dtos/report.dto";
import { getGrowthReport } from "../services/growth.service";
import { calculateWeeklyCompare } from "../services/weekly-compare.service";
import * as reportService from "../services/report.service";

@Route("reports")
@Tags("Report")
export class ReportController extends Controller {
  /**
   * @summary 성장 리포트 조회
   */
  @Get("growth")
  @Security("bearerAuth")
  @Middlewares(authorizeUser())
  @Response(401, "UNAUTHORIZED")
  public async getGrowth(@Request() req: ExpressRequest): Promise<ApiResponse<GrowthReportDto>> {
    const result = await getGrowthReport(req.user!.id);
    return success(result);
  }

  /**
   * @summary 주간 비교 리포트 조회 (이번 주 vs 지난 주)
   */
  @Get("weekly-compare")
  @Security("bearerAuth")
  @Middlewares(authorizeUser())
  @Response(401, "UNAUTHORIZED")
  public async getWeeklyCompare(
    @Request() req: ExpressRequest
  ): Promise<ApiResponse<WeeklyCompareReportDto>> {
    const result = await calculateWeeklyCompare(req.user!.id);
    return success(result);
  }

  /**
   * @summary 리포트 저장
   */
  @Post()
  @Security("bearerAuth")
  @Middlewares(authorizeUser(), validate(saveReportRequestSchema))
  @Response(400, "VALIDATION_ERROR")
  @Response(401, "UNAUTHORIZED")
  public async save(
    @Request() req: ExpressRequest,
    @Body() body: SaveReportRequestDto
  ): Promise<ApiResponse<SaveReportResponseDto>> {
    const result = await reportService.saveReport(req.user!.id, body);
    return success(result, "리포트가 저장되었습니다.");
  }

  /**
   * @summary 리포트 목록 조회
   */
  @Get()
  @Security("bearerAuth")
  @Middlewares(authorizeUser())
  @Response(401, "UNAUTHORIZED")
  public async list(
    @Request() req: ExpressRequest,
    @Query() type?: "growth" | "weekly_compare"
  ): Promise<ApiResponse<ListReportsResponseDto>> {
    const parsed = listReportsQuerySchema.safeParse({ type });
    if (!parsed.success) {
      throw new ValidationError("잘못된 조회 조건입니다.", parsed.error.issues);
    }
    const result = await reportService.listReports(req.user!.id, parsed.data);
    return success(result);
  }

  /**
   * @summary 리포트 상세 조회
   */
  @Get("{reportId}")
  @Security("bearerAuth")
  @Middlewares(authorizeUser())
  @Response(401, "UNAUTHORIZED")
  @Response(404, "NOT_FOUND")
  public async getDetail(
    @Request() req: ExpressRequest,
    @Path() reportId: string
  ): Promise<ApiResponse<ReportDetailResponseDto>> {
    const result = await reportService.getReportDetail(req.user!.id, reportId);
    return success(result);
  }

  /**
   * @summary 리포트 저장 해제
   */
  @Delete("{reportId}")
  @Security("bearerAuth")
  @Middlewares(authorizeUser())
  @Response(401, "UNAUTHORIZED")
  @Response(404, "NOT_FOUND")
  public async deleteReport(
    @Request() req: ExpressRequest,
    @Path() reportId: string
  ): Promise<ApiResponse<DeleteReportResponseDto>> {
    const result = await reportService.deleteReport(req.user!.id, reportId);
    return success(result, "리포트 저장이 해제되었습니다.");
  }
}
