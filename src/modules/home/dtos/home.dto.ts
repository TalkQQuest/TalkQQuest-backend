export interface TodayMissionDto {
    id: string;
    title: string;
    category: string;
    difficulty: number;
    estimatedMinutes: number;
    rewardXp: number;
}

export interface HomeSummaryResponseDto {
    nickname: string | null;
    level: number;
    currentXp: number;
    nextLevelXp: number;
    todayMission: TodayMissionDto | null;
    archiveCount: number;
    communityCount: number;
    questionOfDay: string;
}