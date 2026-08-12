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

// #199 — 알림 삭제. 소유권 확인(findNotificationById)은 서비스 레이어에서 먼저 하므로
// 여기서는 id로 바로 지운다.
export const deleteNotification = (notificationId: string) =>
    prisma.notifications.delete({ where: { id: notificationId } });

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
