// modules/mission/controllers/mission.controller.ts
import { Body, Controller, Delete, Get, Middlewares, Path, Post, Query, Request, Response, Route, Security, Tags } from "tsoa";
import type { Request as ExpressRequest } from "express";
import { authorizeUser } from "../../../middlewares/auth";
import { validate } from "../../../middlewares/validator";
import { ValidationError } from "../../../shared/errors/common.error";
import { success, ApiResponse } from "../../../shared/utils/response";
import {
  getMissionsQuerySchema,
  getTodayMissionQuerySchema,
  MissionListResponseDto,
  MissionDetailResponseDto,
  MissionPrepResponseDto,
  MissionSaveResponseDto,
  MissionUnsaveResponseDto,
  SaveRecommendedMissionRequestDto,
  saveRecommendedMissionRequestSchema,
  SaveRecommendedMissionResponseDto,
  TodayMissionResponseDto,
  LlmHealthResponseDto
} from "../dtos/mission.dto";
import * as missionService from "../services/mission.service";
import { pingLlm } from "../services/llm.service";

@Route("missions")
@Tags("Mission")
export class MissionController extends Controller {
  /**
   * @summary 미션 목록 및 필터 조회
   */
  @Get()
  @Security("bearerAuth")
  @Middlewares(authorizeUser())
  @Response(400, "VALIDATION_ERROR")
  @Response(401, "UNAUTHORIZED")
  public async getMissions(@Request() req: ExpressRequest): Promise<ApiResponse<MissionListResponseDto>> {
    const parsed = getMissionsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError("잘못된 조회 조건입니다.", parsed.error.issues);
    }

    const result = await missionService.getMissions(req.user!.id, parsed.data);
    return success(result);
  }

  /**
   * @summary 오늘의 추천 미션 조회
   *
   * 오늘 이미 받은 추천이 있으면 그대로 돌려주고, 없으면 새로 뽑는다.
   * `refresh=true`로 다시 뽑을 수 있으며 하루 3회까지 가능하다.
   */
  @Get("today")
  @Security("bearerAuth")
  @Middlewares(authorizeUser())
  @Response(400, "VALIDATION_ERROR")
  @Response(400, "INVALID_MISSION_DATE")
  @Response(401, "UNAUTHORIZED")
  @Response(404, "MISSION_PROFILE_NOT_FOUND")
  @Response(429, "MISSION_REFRESH_LIMIT_EXCEEDED")
  public async getTodayMission(
    @Request() req: ExpressRequest,
    /** 클라이언트 기준 오늘 날짜(YYYY-MM-DD). 생략하면 서버(KST) 기준 오늘. */
    @Query() date?: string,
    /** true면 오늘 추천이 있어도 새로 뽑는다(하루 3회 제한). */
    @Query() refresh?: boolean
  ): Promise<ApiResponse<TodayMissionResponseDto>> {
    const parsed = getTodayMissionQuerySchema.safeParse({ date, refresh });
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message, parsed.error.issues);
    }

    const result = await missionService.getTodayMission(req.user!.id, parsed.data);
    return success(result);
  }

  /**
   * @summary 추천받은 미션을 실제 미션으로 저장
   */
  @Post("from-recommendation")
  @Security("bearerAuth")
  @Middlewares(authorizeUser(), validate(saveRecommendedMissionRequestSchema))
  @Response(400, "VALIDATION_ERROR")
  @Response(401, "UNAUTHORIZED")
  @Response(404, "RECOMMENDATION_LOG_NOT_FOUND")
  public async saveRecommendedMission(
    @Body() body: SaveRecommendedMissionRequestDto,
    @Request() req: ExpressRequest
  ): Promise<ApiResponse<SaveRecommendedMissionResponseDto>> {
    const result = await missionService.saveRecommendedMission(req.user!.id, body.recommendationLogId);
    return success(result, "미션이 저장되었습니다.");
  }

  /**
   * @summary LLM(Upstage) 연결 상태 점검 (진단용)
   */
  @Get("llm-health")
  @Security("bearerAuth")
  @Middlewares(authorizeUser())
  @Response(401, "UNAUTHORIZED")
  public async getLlmHealth(): Promise<ApiResponse<LlmHealthResponseDto>> {
    const result = await pingLlm();
    return success(result);
  }

  /**
   * @summary 미션 상세 조회
   */
  @Get("{missionId}")
  @Security("bearerAuth")
  @Middlewares(authorizeUser())
  @Response(401, "UNAUTHORIZED")
  @Response(404, "MISSION_NOT_FOUND")
  public async getMissionDetail(
    @Request() req: ExpressRequest,
    @Path() missionId: string
  ): Promise<ApiResponse<MissionDetailResponseDto>> {
    const result = await missionService.getMissionDetail(req.user!.id, missionId);
    return success(result);
  }

  /**
 * @summary 미션 아카이브 저장
 */
@Post("{missionId}/save")
@Security("bearerAuth")
@Middlewares(authorizeUser())
@Response(401, "UNAUTHORIZED")
@Response(404, "MISSION_NOT_FOUND")
@Response(409, "DUPLICATED")
public async saveMission(
  @Request() req: ExpressRequest,
  @Path() missionId: string
): Promise<ApiResponse<MissionSaveResponseDto>> {
  const result = await missionService.saveMission(req.user!.id, missionId);
  return success(result, "미션이 저장되었습니다.");
}

/**
 * @summary 미션 저장 취소
 */
@Delete("{missionId}/save")
@Security("bearerAuth")
@Middlewares(authorizeUser())
@Response(401, "UNAUTHORIZED")
@Response(404, "SAVE_NOT_FOUND")
public async unsaveMission(
  @Request() req: ExpressRequest,
  @Path() missionId: string
): Promise<ApiResponse<MissionUnsaveResponseDto>> {
  const result = await missionService.unsaveMission(req.user!.id, missionId);
  return success(result, "미션 저장이 취소되었습니다.");
}

  /**
   * @summary 대화 시작 준비 문장 조회
   */
  @Get("{missionId}/prep")
  @Security("bearerAuth")
  @Middlewares(authorizeUser())
  @Response(401, "UNAUTHORIZED")
  @Response(404, "MISSION_NOT_FOUND")
  public async getMissionPrep(@Path() missionId: string): Promise<ApiResponse<MissionPrepResponseDto>> {
    const result = await missionService.getMissionPrep(missionId);
    return success(result);
  }
}