import {
    findNotificationsByUserId,
    findNotificationById,
    markNotificationAsRead,
    markAllNotificationsAsRead,
    findNotificationSettings,
    updateNotificationSettings,
    createNotification,
    deleteNotification,
    deleteAllNotifications,
} from "../repositories/notification.repository";
import {
    NotificationsResponseDto,
    NotificationSettingsResponseDto,
    UpdateNotificationSettingsRequestDto,
    DeleteNotificationResponseDto,
} from "../dtos/notification.dto";
import { NotFoundError } from "../../../shared/errors/common.error";
import { logger } from "../../../config/logger";
import { sendPushToUser } from "./push.service";

// #159 — 인앱 알림(Notifications 테이블) 생성과 실제 기기 푸시 발송을 함께 처리한다.
// 이 함수가 알림을 만드는 유일한 경로가 되도록, 기존에 createNotification을 직접 부르던
// 자리를 전부 이 함수로 교체한다 — 그래야 새 알림 종류가 추가돼도 자동으로 푸시까지 나간다.
// 푸시 발송 실패가 알림 생성 자체를 막으면 안 되므로 try/catch로 감싼다.
export const notifyUser = async (
    userId: string,
    type: string,
    title: string,
    body?: string,
    referenceId?: string,
    referenceType?: string
): Promise<void> => {
    await createNotification(userId, type, title, body, referenceId, referenceType);

    try {
        await sendPushToUser(userId, { title, body: body ?? "", data: { type, referenceId, referenceType } });
    } catch (error) {
        logger.warn({ err: error, userId, type }, "푸시 발송 중 예기치 못한 오류 (인앱 알림은 정상 생성됨)");
    }
};

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

    export const deleteMyNotification = async (
    userId: string,
    notificationId: string
    ): Promise<DeleteNotificationResponseDto> => {
    const notification = await findNotificationById(notificationId, userId);
    if (!notification) {
        throw new NotFoundError("존재하지 않는 알림입니다.");
    }

    await deleteNotification(notificationId);
    return { notificationId, deleted: true };
    };

    export const deleteAllMyNotifications = async (userId: string): Promise<void> => {
    await deleteAllNotifications(userId);
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
        missionReminderTime: settings.mission_reminder_time,
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
        ...(dto.missionReminderTime !== undefined && { mission_reminder_time: dto.missionReminderTime }),
        ...(dto.communityApproved !== undefined && { community_approved: dto.communityApproved }),
        ...(dto.reportReady !== undefined && { report_ready: dto.reportReady }),
        ...(dto.marketing !== undefined && { marketing: dto.marketing }),
    });
};