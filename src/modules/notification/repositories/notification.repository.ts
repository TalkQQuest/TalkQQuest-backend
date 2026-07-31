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

export const saveFcmToken = (userId: string, fcmToken: string, platform: "android") =>
    prisma.device_Tokens.create({
        data: {
        user_id: userId,
        fcm_token: fcmToken,
        platform,
        last_active_at: new Date(),
        },
    });