import { Prisma } from "@prisma/client";
import { prisma } from "../../../config/database";

export const findNotificationsByUserId = (
    userId: string,
    isRead?: boolean,
    page = 1,
    limit = 20
    ) =>
    prisma.notifications.findMany({
        where: {
        user_id: userId,
        ...(isRead !== undefined && { is_read: isRead }),
        },
        orderBy: { created_at: "desc" },
        skip: (page - 1) * limit,
        take: limit,
    });

export const findNotificationById = (notificationId: string, userId: string) =>
    prisma.notifications.findFirst({
        where: { id: notificationId, user_id: userId },
    });

export const markNotificationAsRead = (notificationId: string) =>
    prisma.notifications.update({
        where: { id: notificationId },
        data: { is_read: true },
    });

export const markAllNotificationsAsRead = (userId: string) =>
    prisma.notifications.updateMany({
        where: { user_id: userId, is_read: false },
        data: { is_read: true },
    });

// #199 — 알림 삭제. id와 user_id를 함께 조건으로 걸어 소유권 확인과 삭제를 한 번의 원자적
// 작업으로 처리한다 — "조회 후 삭제" 2단계로 나누면 그 사이에 다른 요청이 같은 알림을 먼저
// 지웠을 때 delete()가 P2025(레코드 없음)를 던져 의도한 404 대신 500이 나갈 수 있다.
// count가 0이면 본인 소유가 아니거나 이미 삭제된 것이라 서비스에서 404로 처리한다.
export const deleteNotification = (notificationId: string, userId: string) =>
    prisma.notifications.deleteMany({ where: { id: notificationId, user_id: userId } });

export const deleteAllNotifications = (userId: string) =>
    prisma.notifications.deleteMany({ where: { user_id: userId } });

export const findNotificationSettings = (userId: string) =>
    prisma.notification_Settings.findUnique({ where: { user_id: userId } });

export const updateNotificationSettings = (
    userId: string,
    data: Prisma.Notification_SettingsUpdateInput
    ) =>
    prisma.notification_Settings.update({
        where: { user_id: userId },
        data,
    });

// 스케줄러(#172)가 매 분 "지금 몇 시인지"에 맞는 유저를 찾을 때 쓴다. mission_reminder_time은
// "HH:mm" 문자열로 저장돼 있어 타임존 변환 없이 그대로 동등 비교한다.
export const findUsersForMissionReminder = (hhmm: string) =>
    prisma.notification_Settings.findMany({
        where: { mission_reminder: true, mission_reminder_time: hhmm },
        select: { user_id: true },
    });

// #193 — 홈 화면이 "새 주간 비교 리포트가 도착했다" 모달을 띄우고 바로 그 리포트로 보낼 수
// 있도록, 아직 안 읽은 리포트 알림 중 가장 최근 것을 찾는다. 읽음 처리(PATCH .../read)되면
// 더 이상 이 조회에 걸리지 않으므로 모달이 다시 뜨지 않는다.
// type도 함께 걸러야 한다 — reference_type만 보면, 나중에 weekly_compare를 참조하는 다른
// 종류의 알림(예: 댓글 알림)이 생겼을 때 그걸 "새 리포트 도착"으로 잘못 인식할 수 있다.
export const findLatestUnreadNotificationByReferenceType = (
    userId: string,
    type: string,
    referenceType: string
) =>
    prisma.notifications.findFirst({
        where: { user_id: userId, type, reference_type: referenceType, is_read: false },
        orderBy: { created_at: "desc" },
        select: { reference_id: true },
    });

export const createNotification = (
    userId: string,
    type: string,
    title: string,
    body?: string,
    referenceId?: string,
    referenceType?: string
    ) =>
    prisma.notifications.create({
        data: {
        user_id: userId,
        type,
        title,
        body: body ?? null,
        reference_id: referenceId ?? null,
        reference_type: referenceType ?? null,
        },
});
