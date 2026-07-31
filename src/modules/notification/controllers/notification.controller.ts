import { Body, Controller, Get, Middlewares, Patch, Path, Post, Query, Request, Route, Security, Tags } from "tsoa";
import type { Request as ExpressRequest } from "express";
import { authorizeUser } from "../../../middlewares/auth";
import { success, ApiResponse } from "../../../shared/utils/response";
import {
    NotificationsResponseDto,
    NotificationSettingsResponseDto,
    UpdateNotificationSettingsRequestDto,
    RegisterFcmTokenRequestDto,
} from "../dtos/notification.dto";
import {
    getNotifications,
    readNotification,
    readAllNotifications,
    getNotificationSettings,
    updateNotificationSettingsService,
    registerFcmToken,
} from "../services/notification.service";

@Route("notifications")
@Tags("Notification")
export class NotificationController extends Controller {
    /**
     * @summary 알림 목록 조회
     */
    @Get()
    @Security("bearerAuth")
    @Middlewares(authorizeUser())
    public async getNotifications(
        @Request() req: ExpressRequest,
        @Query() isRead?: boolean,
        @Query() page?: number,
        @Query() limit?: number
    ): Promise<ApiResponse<NotificationsResponseDto>> {
        const result = await getNotifications(
        req.user!.id,
        isRead,
        page ?? 1,
        limit ?? 20
        );
        return success(result);
    }

    /**
     * @summary 알림 읽음 처리
     */
    @Patch("{notificationId}/read")
    @Security("bearerAuth")
    @Middlewares(authorizeUser())
    public async readNotification(
        @Path() notificationId: string,
        @Request() req: ExpressRequest
    ): Promise<ApiResponse<null>> {
        await readNotification(req.user!.id, notificationId);
        return success(null, "알림이 읽음 처리되었습니다.");
    }

    /**
     * @summary 알림 전체 읽음 처리
     */
    @Patch("all/read")
    @Security("bearerAuth")
    @Middlewares(authorizeUser())
    public async readAllNotifications(
        @Request() req: ExpressRequest
    ): Promise<ApiResponse<null>> {
        await readAllNotifications(req.user!.id);
        return success(null, "모든 알림이 읽음 처리되었습니다.");
    }

    /**
     * @summary 알림 설정 조회
     */
    @Get("settings")
    @Security("bearerAuth")
    @Middlewares(authorizeUser())
    public async getNotificationSettings(
        @Request() req: ExpressRequest
    ): Promise<ApiResponse<NotificationSettingsResponseDto>> {
        const result = await getNotificationSettings(req.user!.id);
        return success(result);
    }

    /**
     * @summary 알림 설정 수정
     */
    @Patch("settings")
    @Security("bearerAuth")
    @Middlewares(authorizeUser())
    public async updateNotificationSettings(
        @Body() body: UpdateNotificationSettingsRequestDto,
        @Request() req: ExpressRequest
    ): Promise<ApiResponse<null>> {
        await updateNotificationSettingsService(req.user!.id, body);
        return success(null, "알림 설정이 수정되었습니다.");
    }

    /**
     * @summary FCM 토큰 등록
     */
    @Post("fcm-token")
    @Security("bearerAuth")
    @Middlewares(authorizeUser())
    public async registerFcmToken(
        @Body() body: RegisterFcmTokenRequestDto,
        @Request() req: ExpressRequest
    ): Promise<ApiResponse<null>> {
        await registerFcmToken(req.user!.id, body);
        return success(null, "FCM 토큰이 등록되었습니다.");
    }
}