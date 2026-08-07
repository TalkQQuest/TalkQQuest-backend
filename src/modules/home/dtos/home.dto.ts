import { MissionDifficultyLabel } from "../../mission/dtos/mission.constants";
import { GrowthMetricTotalsDto } from "../../report/dtos/report.dto";

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
    /**
     * 성장 리포트와 동일한 능력별 누적 점수(#145). 홈 화면 레벨 카드 아래 티어 한 줄 표시용.
     * 티어/별/마름모 계산은 클라이언트가 이 값으로 직접 한다.
     */
    growthTotals: GrowthMetricTotalsDto;
}