export interface TodayMissionDto {
    id: string;
    title: string;
    description: string;
    category: string;
    difficulty: string;
    estimatedMinutes: number;
    rewardXp: number;
    isCompleted: boolean;
    isSaved: boolean;
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