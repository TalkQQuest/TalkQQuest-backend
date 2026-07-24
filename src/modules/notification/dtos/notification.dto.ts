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
    communityApproved: boolean;
    reportReady: boolean;
    marketing: boolean;
}

export interface UpdateNotificationSettingsRequestDto {
    missionReminder?: boolean;
    communityApproved?: boolean;
    reportReady?: boolean;
    marketing?: boolean;
}