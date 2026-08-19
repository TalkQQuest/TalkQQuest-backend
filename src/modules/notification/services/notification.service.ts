import {
    findNotificationsByUserId,
    findNotificationById,
    markNotificationAsRead,
    markAllNotificationsAsRead,
    findNotificationSettings,
    upsertNotificationSettings,
    createNotification,
    deleteNotification,
    deleteAllNotifications,
    findLatestUnreadNotificationByReferenceType,
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

// #264 — 미션 완료 등 매번 발생하는 알림까지 시스템 푸시가 울리면 사용자가 거슬려해서,
// Android 시스템 푸시는 이 집합에 속한 타입에만 발송한다. mission_reminder는 사용자가
// 직접 설정한 시각에 하루 한 번만 울리므로 weekly_compare_ready와 함께 허용한다.
const FCM_NOTIFICATION_TYPES = new Set(["weekly_compare_ready", "mission_reminder"]);

// 인앱 알림은 모든 타입을 저장하되, Android 시스템 푸시는 위 허용 타입에만 발송한다.
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

    if (!FCM_NOTIFICATION_TYPES.has(type)) return;

    try {
        await sendPushToUser(userId, { title, body: body ?? "", data: { type, referenceId, referenceType } });
    } catch (error) {
        logger.warn({ err: error, userId, type }, "푸시 발송 중 예기치 못한 오류 (인앱 알림은 정상 생성됨)");
    }
};

// #193 — 홈 요약(GET /home/summary)이 "새 주간 비교 리포트 도착" 모달을 띄울지 판단할 때 쓴다.
// 안 읽은 주간 비교 리포트 알림이 있으면 그 리포트 id를, 없으면 null을 돌려준다.
export const getLatestUnreadReportId = async (
    userId: string,
    type: string,
    referenceType: string
): Promise<string | null> => {
    const notification = await findLatestUnreadNotificationByReferenceType(userId, type, referenceType);
    return notification?.reference_id ?? null;
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
        referenceId: n.reference_id,
        referenceType: n.reference_type,
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
    const result = await deleteNotification(notificationId, userId);
    if (result.count === 0) {
        throw new NotFoundError("존재하지 않는 알림입니다.");
    }

    return { notificationId, deleted: true };
    };

    export const deleteAllMyNotifications = async (userId: string): Promise<void> => {
    await deleteAllNotifications(userId);
    };

    // #215 — 회원가입 시점에 Notification_Settings 행을 만들어주지 않아 모든 사용자가 404를
    // 받고 있었다. upsert로 처리해 없으면 스키마 기본값으로 즉시 생성한다(기존 가입자 포함,
    // 별도 백필 없이 첫 호출에서 자동으로 해결된다).
    export const getNotificationSettings = async (
    userId: string
    ): Promise<NotificationSettingsResponseDto> => {
    const settings = await upsertNotificationSettings(userId, {});

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
    await upsertNotificationSettings(userId, {
        ...(dto.missionReminder !== undefined && { mission_reminder: dto.missionReminder }),
        ...(dto.missionReminderTime !== undefined && { mission_reminder_time: dto.missionReminderTime }),
        ...(dto.communityApproved !== undefined && { community_approved: dto.communityApproved }),
        ...(dto.reportReady !== undefined && { report_ready: dto.reportReady }),
        ...(dto.marketing !== undefined && { marketing: dto.marketing }),
    });
};
