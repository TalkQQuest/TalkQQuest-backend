export interface BadgeItem {
    id: string;
    name: string;
    iconUrl: string | null;
}

export interface WeeklyMissionStatus {
    completed: number;
    total: number;
}

export interface RecentMissionItem {
    id: string;
    title: string;
    result: string;
    completedAt: string | null;
}

export interface DashboardResponseDto {
    nickname: string | null;
    email: string | null;
    avatarUrl: string | null;
    level: number;
    xp: number;
    badges: BadgeItem[];
    weeklyMissionStatus: WeeklyMissionStatus;
    weeklyDays: boolean[];
    recentMissionSummary: RecentMissionItem[];
}