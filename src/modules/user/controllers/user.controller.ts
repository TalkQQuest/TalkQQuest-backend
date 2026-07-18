import { Body, Controller, Get, Middlewares, Patch, Post, Request, Response, Route, Security, Tags } from "tsoa";
import type { Request as ExpressRequest } from "express";
import { authorizeUser } from "../../../middlewares/auth";
import { validate } from "../../../middlewares/validator";
import { success, ApiResponse } from "../../../shared/utils/response";
import {
  MyProfileResponseDto,
  UpdateProfileRequestDto,
  updateProfileRequestSchema,
} from "../dtos/user-profile.dto";
import {
  OnboardingCompleteResponseDto,
  OnboardingStepRequestDto,
  OnboardingStepResponseDto,
  onboardingStepRequestSchema,
} from "../dtos/onboarding.dto";
import { getMyProfile, updateMyProfile, withdrawUser } from "../services/user-profile.service";
import { completeOnboarding, saveOnboardingStep } from "../services/onboarding.service";

@Route("users")
@Tags("User")
export class UserController extends Controller {
  /**
   * @summary 내 프로필 조회
   */
  @Get("me")
  @Security("bearerAuth")
  @Middlewares(authorizeUser())
  @Response(401, "UNAUTHORIZED")
  @Response(404, "NOT_FOUND")
  public async getMe(@Request() req: ExpressRequest): Promise<ApiResponse<MyProfileResponseDto>> {
    const result = await getMyProfile(req.user!.id);
    return success(result);
  }

  /**
   * @summary 내 프로필 수정
   */
  @Patch("me")
  @Security("bearerAuth")
  @Middlewares(authorizeUser(), validate(updateProfileRequestSchema))
  @Response(400, "VALIDATION_ERROR")
  @Response(401, "UNAUTHORIZED")
  @Response(404, "NOT_FOUND")
  public async updateMe(
    @Request() req: ExpressRequest,
    @Body() body: UpdateProfileRequestDto
  ): Promise<ApiResponse<null>> {
    await updateMyProfile(req.user!.id, body);
    return success(null, "프로필이 수정되었습니다.");
  }

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

  /**
   * @summary 회원 탈퇴 (soft delete)
   */
  @Post("me")
  @Security("bearerAuth")
  @Middlewares(authorizeUser())
  @Response(401, "UNAUTHORIZED")
  @Response(404, "NOT_FOUND")
  public async withdrawMe(
    @Request() req: ExpressRequest
  ): Promise<ApiResponse<null>> {
    await withdrawUser(req.user!.id);
    return success(null, "탈퇴가 완료되었습니다.");
  }
}