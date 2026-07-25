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
  ChangePasswordRequestDto,
  VerifyPasswordRequestDto,
  changePasswordRequestSchema,
  verifyPasswordRequestSchema,
} from "../dtos/password.dto";
import { UsageResponseDto } from "../dtos/usage.dto";
import { DashboardResponseDto } from "../dtos/dashboard.dto";
import { getMyProfile, updateMyProfile, withdrawUser } from "../services/user-profile.service";
import { changePassword, verifyCurrentPassword } from "../../auth/services/password.service";
import { getMyUsage as fetchMyUsage } from "../services/usage.service";
import { getDashboard } from "../services/dashboard.service";

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
   * @summary 비밀번호 변경 전 현재 비밀번호 확인
   */
  @Post("me/password/verify")
  @Security("bearerAuth")
  @Middlewares(authorizeUser(), validate(verifyPasswordRequestSchema))
  @Response(400, "VALIDATION_ERROR")
  @Response(400, "INVALID_PASSWORD")
  @Response(401, "UNAUTHORIZED")
  @Response(404, "NOT_FOUND")
  public async verifyMyPassword(
    @Request() req: ExpressRequest,
    @Body() body: VerifyPasswordRequestDto
  ): Promise<ApiResponse<null>> {
    await verifyCurrentPassword(req.user!.id, body.currentPassword);
    return success(null, "비밀번호가 확인되었습니다.");
  }

  /**
   * @summary 비밀번호 변경
   */
  @Patch("me/password")
  @Security("bearerAuth")
  @Middlewares(authorizeUser(), validate(changePasswordRequestSchema))
  @Response(400, "VALIDATION_ERROR")
  @Response(401, "UNAUTHORIZED")
  @Response(403, "FORBIDDEN")
  public async changeMyPassword(
    @Request() req: ExpressRequest,
    @Body() body: ChangePasswordRequestDto
  ): Promise<ApiResponse<null>> {
    await changePassword(req.user!.id, body.newPassword);
    return success(null, "비밀번호가 변경되었습니다.");
  }

  /**
   * @summary 사용량 조회
   */
  @Get("me/usage")
  @Security("bearerAuth")
  @Middlewares(authorizeUser())
  @Response(401, "UNAUTHORIZED")
  @Response(404, "NOT_FOUND")
  public async getMyUsage(@Request() req: ExpressRequest): Promise<ApiResponse<UsageResponseDto>> {
    const result = await fetchMyUsage(req.user!.id);
    return success(result);
  }

  /**
   * @summary 마이페이지 요약 조회
   */
  @Get("me/dashboard")
  @Security("bearerAuth")
  @Middlewares(authorizeUser())
  @Response(401, "UNAUTHORIZED")
  @Response(404, "NOT_FOUND")
  public async getMyDashboard(
    @Request() req: ExpressRequest
  ): Promise<ApiResponse<DashboardResponseDto>> {
    const result = await getDashboard(req.user!.id);
    return success(result);
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