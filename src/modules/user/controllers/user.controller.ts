import { Body, Controller, Get, Middlewares, Patch, Post, Request, Route, Tags } from "tsoa";
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
import { getMyProfile, updateMyProfile } from "../services/user-profile.service";
import { completeOnboarding, saveOnboardingStep } from "../services/onboarding.service";

@Route("users")
@Tags("User")
export class UserController extends Controller {
  /**
   * @summary 내 프로필 조회
   */
  @Get("me")
  @Middlewares(authorizeUser())
  public async getMe(@Request() req: ExpressRequest): Promise<ApiResponse<MyProfileResponseDto>> {
    const result = await getMyProfile(req.user!.id);
    return success(result);
  }

  /**
   * @summary 내 프로필 수정
   */
  @Patch("me")
  @Middlewares(authorizeUser(), validate(updateProfileRequestSchema))
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
  @Middlewares(authorizeUser(), validate(onboardingStepRequestSchema))
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
  @Middlewares(authorizeUser())
  public async completeMyOnboarding(
    @Request() req: ExpressRequest
  ): Promise<ApiResponse<OnboardingCompleteResponseDto>> {
    const result = await completeOnboarding(req.user!.id);
    return success(result, "온보딩이 완료되었습니다.");
  }
}
