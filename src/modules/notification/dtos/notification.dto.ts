import { z } from "zod";

export interface NotificationItem {
    id: string;
    type: string;
    title: string;
    body: string | null;
    isRead: boolean;
    createdAt: string;
}

export interface NotificationsResponseDto {
    notifications: NotificationItem[];
}

export interface NotificationSettingsResponseDto {
    missionReminder: boolean;
    missionReminderTime: string;
    communityApproved: boolean;
    reportReady: boolean;
    marketing: boolean;
}

export interface UpdateNotificationSettingsRequestDto {
    missionReminder?: boolean;
    missionReminderTime?: string;
    communityApproved?: boolean;
    reportReady?: boolean;
    marketing?: boolean;
}

// Zod 검증용 스키마 (design.md에서 지적된, notifications/settings에 검증이 연결되지 않은 문제를 #172에서 같이 보완)
export const updateNotificationSettingsRequestSchema = z.object({
    missionReminder: z.boolean().optional(),
    missionReminderTime: z
        .string()
        .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "missionReminderTime은 HH:mm 형식이어야 합니다")
        .optional(),
    communityApproved: z.boolean().optional(),
    reportReady: z.boolean().optional(),
    marketing: z.boolean().optional(),
});