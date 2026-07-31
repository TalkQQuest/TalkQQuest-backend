import {
    findNotificationsByUserId,
    findNotificationById,
    markNotificationAsRead,
    markAllNotificationsAsRead,
    findNotificationSettings,
    updateNotificationSettings,
    upsertFcmToken,
} from "../repositories/notification.repository";
import {
    NotificationsResponseDto,
    NotificationSettingsResponseDto,
    UpdateNotificationSettingsRequestDto,
    RegisterFcmTokenRequestDto,
} from "../dtos/notification.dto";
import { NotFoundError } from "../../../shared/errors/common.error";

export const getNotifications = async (
    userId: string,
    isRead?: boolean,
    page = 1,
    limit = 20
    ): Promise<NotificationsResponseDto> => {
    const notifications = await findNotificationsByUserId(userId, isRead, page, limit);

    return {
        notifications: notifications.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body ?? null,
        isRead: n.is_read,
        createdAt: n.created_at.toISOString(),
        })),
    };
};

export const readNotification = async (
    userId: string,
    notificationId: string
    ): Promise<void> => {
    const notification = await findNotificationById(notificationId, userId);
    if (!notification) {
        throw new NotFoundError("존재하지 않는 알림입니다.");
    }

    await markNotificationAsRead(notificationId);
};

export const readAllNotifications = async (userId: string): Promise<void> => {
    await markAllNotificationsAsRead(userId);
};

export const getNotificationSettings = async (
    userId: string
    ): Promise<NotificationSettingsResponseDto> => {
    const settings = await findNotificationSettings(userId);
    if (!settings) {
        throw new NotFoundError("알림 설정을 찾을 수 없습니다.");
    }

    return {
        missionReminder: settings.mission_reminder,
        communityApproved: settings.community_approved,
        reportReady: settings.report_ready,
        marketing: settings.marketing,
    };
};

export const updateNotificationSettingsService = async (
    userId: string,
    dto: UpdateNotificationSettingsRequestDto
    ): Promise<void> => {
    const settings = await findNotificationSettings(userId);
    if (!settings) {
        throw new NotFoundError("알림 설정을 찾을 수 없습니다.");
    }

    await updateNotificationSettings(userId, {
        ...(dto.missionReminder !== undefined && { mission_reminder: dto.missionReminder }),
        ...(dto.communityApproved !== undefined && { community_approved: dto.communityApproved }),
        ...(dto.reportReady !== undefined && { report_ready: dto.reportReady }),
        ...(dto.marketing !== undefined && { marketing: dto.marketing }),
    });
};

export const registerFcmToken = async (
    userId: string,
    dto: RegisterFcmTokenRequestDto
    ): Promise<void> => {
    await upsertFcmToken(userId, dto.fcmToken, dto.platform ?? "android");
};