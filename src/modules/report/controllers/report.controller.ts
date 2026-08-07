import { Body, Controller, Delete, Get, Middlewares, Path, Post, Request, Response, Route, Security, Tags } from "tsoa";
import type { Request as ExpressRequest } from "express";
import { authorizeUser } from "../../../middlewares/auth";
import { validate } from "../../../middlewares/validator";
import { success, ApiResponse } from "../../../shared/utils/response";
import {
  DeleteReportResponseDto,
  DeleteWeeklyCompareReportResponseDto,
  GrowthReportDto,
  ListReportsResponseDto,
  ListWeeklyCompareReportsResponseDto,
  ReportDetailResponseDto,
  SaveReportRequestDto,
  saveReportRequestSchema,
  SaveReportResponseDto,
  SaveWeeklyCompareReportResponseDto,
  WeeklyCompareReportDetailResponseDto,
} from "../dtos/report.dto";
import { getGrowthReport } from "../services/growth.service";
import * as reportService from "../services/report.service";

@Route("reports")
@Tags("Report")
export class ReportController extends Controller {
  /**
   * @summary 성장 리포트 조회 (라이브 계산 — 언제든 최신 상태)
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
   * @summary 성장 리포트 저장 (대화 단위, 같은 대화로 재저장 시 기존 결과 반환)
   */
  @Post()
  @Security("bearerAuth")
  @Middlewares(authorizeUser(), validate(saveReportRequestSchema))
  @Response(400, "VALIDATION_ERROR")
  @Response(401, "UNAUTHORIZED")
  @Response(404, "NOT_FOUND")
  public async save(
    @Request() req: ExpressRequest,
    @Body() body: SaveReportRequestDto
  ): Promise<ApiResponse<SaveReportResponseDto>> {
    const result = await reportService.saveReport(req.user!.id, body.conversationId);
    return success(result, "리포트가 저장되었습니다.");
  }

  /**
   * @summary 성장 리포트 목록 조회
   */
  @Get()
  @Security("bearerAuth")
  @Middlewares(authorizeUser())
  @Response(401, "UNAUTHORIZED")
  public async list(@Request() req: ExpressRequest): Promise<ApiResponse<ListReportsResponseDto>> {
    const result = await reportService.listReports(req.user!.id);
    return success(result);
  }

  /**
   * @summary 주간 비교 리포트 목록 조회 (자동 생성된 것들, 완결 주 단위)
   */
  @Get("weekly-compare")
  @Security("bearerAuth")
  @Middlewares(authorizeUser())
  @Response(401, "UNAUTHORIZED")
  public async listWeeklyCompare(
    @Request() req: ExpressRequest
  ): Promise<ApiResponse<ListWeeklyCompareReportsResponseDto>> {
    const result = await reportService.listWeeklyCompareReports(req.user!.id);
    return success(result);
  }

  /**
   * @summary 주간 비교 리포트 상세 조회
   */
  @Get("weekly-compare/{weeklyCompareReportId}")
  @Security("bearerAuth")
  @Middlewares(authorizeUser())
  @Response(401, "UNAUTHORIZED")
  @Response(404, "NOT_FOUND")
  public async getWeeklyCompareDetail(
    @Request() req: ExpressRequest,
    @Path() weeklyCompareReportId: string
  ): Promise<ApiResponse<WeeklyCompareReportDetailResponseDto>> {
    const result = await reportService.getWeeklyCompareReportDetail(req.user!.id, weeklyCompareReportId);
    return success(result);
  }

  /**
   * @summary 주간 비교 리포트 저장 (Archive에 추가, 같은 리포트 재저장 시 기존 결과 반환)
   */
  @Post("weekly-compare/{weeklyCompareReportId}/save")
  @Security("bearerAuth")
  @Middlewares(authorizeUser())
  @Response(401, "UNAUTHORIZED")
  @Response(404, "NOT_FOUND")
  public async saveWeeklyCompare(
    @Request() req: ExpressRequest,
    @Path() weeklyCompareReportId: string
  ): Promise<ApiResponse<SaveWeeklyCompareReportResponseDto>> {
    const result = await reportService.saveWeeklyCompareReport(req.user!.id, weeklyCompareReportId);
    return success(result, "주간 비교 리포트가 저장되었습니다.");
  }

  /**
   * @summary 주간 비교 리포트 저장 해제 (저장된 것만 삭제 가능)
   */
  @Delete("weekly-compare/{weeklyCompareReportId}")
  @Security("bearerAuth")
  @Middlewares(authorizeUser())
  @Response(401, "UNAUTHORIZED")
  @Response(404, "NOT_FOUND")
  public async deleteWeeklyCompare(
    @Request() req: ExpressRequest,
    @Path() weeklyCompareReportId: string
  ): Promise<ApiResponse<DeleteWeeklyCompareReportResponseDto>> {
    const result = await reportService.deleteWeeklyCompareReport(req.user!.id, weeklyCompareReportId);
    return success(result, "주간 비교 리포트 저장이 해제되었습니다.");
  }

  /**
   * @summary 성장 리포트 상세 조회
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
   * @summary 성장 리포트 저장 해제
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
