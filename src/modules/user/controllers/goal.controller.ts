import { Body, Controller, Delete, Get, Middlewares, Patch, Path, Post, Request, Route, Security, Tags } from "tsoa";
import type { Request as ExpressRequest } from "express";
import { authorizeUser } from "../../../middlewares/auth";
import { validate } from "../../../middlewares/validator";
import { success, ApiResponse } from "../../../shared/utils/response";
import {
  CreateGoalRequestDto,
  CreateGoalResponseDto,
  createGoalRequestSchema,
  GoalListResponseDto,
  UpdateGoalRequestDto,
  updateGoalRequestSchema,
} from "../dtos/goal.dto";
import * as goalService from "../services/goal.service";

@Route("goals")
@Tags("Goal")
export class GoalController extends Controller {
  /**
   * @summary 목표 목록 조회
   */
  @Get()
  @Security("bearerAuth")
  @Middlewares(authorizeUser())
  public async getGoals(@Request() req: ExpressRequest): Promise<ApiResponse<GoalListResponseDto>> {
    const result = await goalService.getGoals(req.user!.id);
    return success(result);
  }

  /**
   * @summary 목표 생성
   */
  @Post()
  @Security("bearerAuth")
  @Middlewares(authorizeUser(), validate(createGoalRequestSchema))
  public async createGoal(
    @Request() req: ExpressRequest,
    @Body() body: CreateGoalRequestDto
  ): Promise<ApiResponse<CreateGoalResponseDto>> {
    const result = await goalService.createGoal(req.user!.id, body);
    return success(result, "목표가 생성되었습니다.");
  }

  /**
   * @summary 목표 수정
   */
  @Patch("{goalId}")
  @Security("bearerAuth")
  @Middlewares(authorizeUser(), validate(updateGoalRequestSchema))
  public async updateGoal(
    @Request() req: ExpressRequest,
    @Path() goalId: string,
    @Body() body: UpdateGoalRequestDto
  ): Promise<ApiResponse<null>> {
    await goalService.updateGoal(req.user!.id, goalId, body);
    return success(null, "목표가 수정되었습니다.");
  }

  /**
   * @summary 목표 삭제
   */
  @Delete("{goalId}")
  @Security("bearerAuth")
  @Middlewares(authorizeUser())
  public async deleteGoal(
    @Request() req: ExpressRequest,
    @Path() goalId: string
  ): Promise<ApiResponse<null>> {
    await goalService.deleteGoal(req.user!.id, goalId);
    return success(null, "목표가 삭제되었습니다.");
  }
}
