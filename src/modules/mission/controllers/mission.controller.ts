// modules/mission/controllers/mission.controller.ts
import { Controller, Delete, Get, Middlewares, Path, Post, Request, Route, Security, Tags } from "tsoa";
import type { Request as ExpressRequest } from "express";
import { authorizeUser } from "../../../middlewares/auth";
import { ValidationError } from "../../../shared/errors/common.error";
import { success, ApiResponse } from "../../../shared/utils/response";
import {
  getMissionsQuerySchema,
  MissionListResponseDto,
  MissionDetailResponseDto,
  MissionPrepResponseDto,
  MissionSaveResponseDto,
  MissionUnsaveResponseDto,
  TodayMissionResponseDto
} from "../dtos/mission.dto";
import * as missionService from "../services/mission.service";

@Route("missions")
@Tags("Mission")
export class MissionController extends Controller {
  /**
   * @summary 미션 목록 및 필터 조회
   */
  @Get()
  @Security("bearerAuth")
  @Middlewares(authorizeUser())
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
   */
  @Get("today")
  @Security("bearerAuth")
  @Middlewares(authorizeUser())
  public async getTodayMission(@Request() req: ExpressRequest): Promise<ApiResponse<TodayMissionResponseDto>> {
    const result = await missionService.getTodayMission(req.user!.id);
    return success(result);
  }

  /**
   * @summary 미션 상세 조회
   */
  @Get("{missionId}")
  @Security("bearerAuth")
  @Middlewares(authorizeUser())
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
  public async getMissionPrep(@Path() missionId: string): Promise<ApiResponse<MissionPrepResponseDto>> {
    const result = await missionService.getMissionPrep(missionId);
    return success(result);
  }
}