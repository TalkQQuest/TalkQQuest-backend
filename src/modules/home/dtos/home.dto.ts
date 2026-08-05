import { MissionDifficultyLabel } from "../../mission/dtos/mission.constants";

export interface TodayMissionDto {
    id: string;
    title: string;
    category: string;
    /**
     * 난이도 한글 라벨. 다른 미션 API와 동일하게 "쉬움"|"보통"|"어려움"으로 내려간다
     * (예전에는 여기만 DB의 정수값 1/2/3이 그대로 나갔다).
     */
    difficulty: MissionDifficultyLabel;
    estimatedMinutes: number;
    rewardXp: number;
    /** 홈 카드에서 제목 아래 한 줄로 보여주는 미션 설명. */
    description: string;
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