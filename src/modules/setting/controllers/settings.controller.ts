import { Body, Controller, Get, Middlewares, Patch, Request, Route, Security, Tags } from "tsoa";
import type { Request as ExpressRequest } from "express";
import { authorizeUser } from "../../../middlewares/auth";
import { validate } from "../../../middlewares/validator";
import { success, ApiResponse } from "../../../shared/utils/response";
import { SettingsResponseDto, UpdateSettingsRequestDto, updateSettingsRequestSchema } from "../dtos/settings.dto";
import { getSettings, updateSettingsService } from "../services/settings.service";

@Route("users")
@Tags("User")
export class SettingsController extends Controller {
    /**
     * @summary 설정 조회
     */
    @Get("me/settings")
    @Security("bearerAuth")
    @Middlewares(authorizeUser())
    public async getMySettings(
        @Request() req: ExpressRequest
    ): Promise<ApiResponse<SettingsResponseDto>> {
        const result = await getSettings(req.user!.id);
        return success(result);
    }

    /**
     * @summary 설정 수정
     */
    @Patch("me/settings")
    @Security("bearerAuth")
    @Middlewares(authorizeUser(), validate(updateSettingsRequestSchema))
    public async updateMySettings(
        @Request() req: ExpressRequest,
        @Body() body: UpdateSettingsRequestDto
    ): Promise<ApiResponse<null>> {
        await updateSettingsService(req.user!.id, body);
        return success(null, "설정이 수정되었습니다.");
    }
}