import { Body, Controller, Delete, Get, Middlewares, Post, Request, Route, Security, Tags } from "tsoa";
import type { Request as ExpressRequest } from "express";
import { authorizeUser } from "../../../middlewares/auth";
import { success, ApiResponse } from "../../../shared/utils/response";
import { BlockedUsersResponseDto, BlockUserRequestDto, UnblockUserRequestDto } from "../dtos/safety.dto";
import { getBlockedUsers, blockUser, unblockUser } from "../services/safety.service";

@Route("safety")
@Tags("Safety")
export class SafetyController extends Controller {
    /**
     * @summary 차단 사용자 목록 조회
     */
    @Get("blocked-users")
    @Security("bearerAuth")
    @Middlewares(authorizeUser())
    public async getBlockedUsers(
        @Request() req: ExpressRequest
    ): Promise<ApiResponse<BlockedUsersResponseDto>> {
        const result = await getBlockedUsers(req.user!.id);
        return success(result);
    }

    /**
     * @summary 사용자 차단
     */
    @Post("blocked-users")
    @Security("bearerAuth")
    @Middlewares(authorizeUser())
    public async blockUser(
        @Body() body: BlockUserRequestDto,
        @Request() req: ExpressRequest
    ): Promise<ApiResponse<null>> {
        await blockUser(req.user!.id, body);
        return success(null, "차단되었습니다.");
    }

    /**
     * @summary 사용자 차단 해제
     */
    @Delete("blocked-users")
    @Security("bearerAuth")
    @Middlewares(authorizeUser())
    public async unblockUser(
        @Body() body: UnblockUserRequestDto,
        @Request() req: ExpressRequest
    ): Promise<ApiResponse<null>> {
        await unblockUser(req.user!.id, body);
        return success(null, "차단이 해제되었습니다.");
    }
}