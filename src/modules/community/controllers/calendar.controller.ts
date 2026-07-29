import { Body, Controller, Middlewares, Post, Request, Response, Route, Security, Tags } from "tsoa";
import type { Request as ExpressRequest } from "express";
import { authorizeUser } from "../../../middlewares/auth";
import { validate } from "../../../middlewares/validator";
import { success, ApiResponse } from "../../../shared/utils/response";
import {
    AddCalendarEventRequestDto,
    addCalendarEventRequestSchema,
    AddCalendarEventResponseDto,
} from "../dtos/calendar.dto";
import * as communityService from "../services/community.service";

@Route("calendar")
@Tags("Community")
export class CalendarController extends Controller {
    /**
     * @summary 승인 모임 일정 추가
     */
    @Post("events")
    @Security("bearerAuth")
    @Middlewares(authorizeUser(), validate(addCalendarEventRequestSchema))
    @Response(400, "VALIDATION_ERROR")
    @Response(401, "UNAUTHORIZED")
    @Response(403, "NOT_APPROVED")
    @Response(404, "COMMUNITY_NOT_FOUND")
    public async addEvent(
        @Request() req: ExpressRequest,
        @Body() body: AddCalendarEventRequestDto
    ): Promise<ApiResponse<AddCalendarEventResponseDto>> {
        const result = await communityService.addCalendarEvent(req.user!.id, body.communityId);
        return success(result, "일정이 추가되었습니다.");
    }
}
