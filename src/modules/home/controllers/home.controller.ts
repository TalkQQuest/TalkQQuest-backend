import { Controller, Get, Middlewares, Request, Route, Security, Tags } from "tsoa";
import type { Request as ExpressRequest } from "express";
import { authorizeUser } from "../../../middlewares/auth";
import { success, ApiResponse } from "../../../shared/utils/response";
import { HomeSummaryResponseDto } from "../dtos/home.dto";
import { getHomeSummary } from "../services/home.service";

@Route("home")
@Tags("Home")
export class HomeController extends Controller {
    /**
     * @summary 홈 요약 조회
     */
    @Get("summary")
    @Security("bearerAuth")
    @Middlewares(authorizeUser())
    public async getHomeSummary(
        @Request() req: ExpressRequest
    ): Promise<ApiResponse<HomeSummaryResponseDto>> {
        const result = await getHomeSummary(req.user!.id);
        return success(result);
    }
}