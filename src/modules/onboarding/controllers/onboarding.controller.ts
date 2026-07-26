import { Body, Controller, Middlewares, Patch, Post, Request, Response, Route, Security, Tags } from "tsoa";
import type { Request as ExpressRequest } from "express";
import { authorizeUser } from "../../../middlewares/auth";
import { validate } from "../../../middlewares/validator";
import { success, ApiResponse } from "../../../shared/utils/response";
import {
  OnboardingCompleteResponseDto,
  OnboardingStepRequestDto,
  OnboardingStepResponseDto,
  onboardingStepRequestSchema,
} from "../dtos/onboarding.dto";
import { completeOnboarding, saveOnboardingStep } from "../services/onboarding.service";

// URL 경로는 기존 UserController 시절과 동일하게 "users" 하위를 유지한다 (프런트 계약 변경 없음).
@Route("users")
@Tags("Onboarding")
export class OnboardingController extends Controller {
  /**
   * @summary 온보딩 단계별 저장
   */
  @Patch("me/onboarding")
  @Security("bearerAuth")
  @Middlewares(authorizeUser(), validate(onboardingStepRequestSchema))
  @Response(400, "VALIDATION_ERROR")
  @Response(400, "INVALID_STEP")
  @Response(401, "UNAUTHORIZED")
  @Response(404, "NOT_FOUND")
  public async saveOnboarding(
    @Request() req: ExpressRequest,
    @Body() body: OnboardingStepRequestDto
  ): Promise<ApiResponse<OnboardingStepResponseDto>> {
    const result = await saveOnboardingStep(req.user!.id, body);
    return success(result, "저장되었습니다.");
  }

  /**
   * @summary 온보딩 완료
   */
  @Post("me/onboarding/complete")
  @Security("bearerAuth")
  @Middlewares(authorizeUser())
  @Response(400, "INCOMPLETE_ONBOARDING")
  @Response(401, "UNAUTHORIZED")
  @Response(404, "NOT_FOUND")
  @Response(409, "DUPLICATED")
  public async completeMyOnboarding(
    @Request() req: ExpressRequest
  ): Promise<ApiResponse<OnboardingCompleteResponseDto>> {
    const result = await completeOnboarding(req.user!.id);
    return success(result, "온보딩이 완료되었습니다.");
  }
}
