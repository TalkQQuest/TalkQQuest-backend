import { findHomeSummaryData } from "../repositories/home.repository";
import { HomeSummaryResponseDto } from "../dtos/home.dto";
import { NotFoundError } from "../../../shared/errors/common.error";

const QUESTION_OF_DAY = "오늘 누군가에게 먼저 말을 걸어본 적 있나요?";
const XP_PER_LEVEL = 100;

const DIFFICULTY_LABEL: Record<number, string> = {
    1: "쉬움",
    2: "보통",
    3: "어려움",
};

export const getHomeSummary = async (userId: string): Promise<HomeSummaryResponseDto> => {
    const { profile, archiveCount, communityCount, todayMission } =
        await findHomeSummaryData(userId);

    if (!profile) {
        throw new NotFoundError("사용자를 찾을 수 없습니다.");
    }

    const nextLevelXp = profile.level * XP_PER_LEVEL;

    return {
        nickname: profile.nickname,
        level: profile.level,
        currentXp: profile.xp,
        nextLevelXp,
        todayMission: todayMission
        ? {
            id: todayMission.id,
            title: todayMission.title,
            description: todayMission.description,
            category: todayMission.category,
            difficulty: DIFFICULTY_LABEL[todayMission.difficulty] ?? String(todayMission.difficulty),
            estimatedMinutes: todayMission.estimated_minutes,
            rewardXp: todayMission.reward_xp,
            isCompleted: todayMission.mission_records.length > 0,
            isSaved: todayMission.saves.length > 0,
            }
        : null,
        archiveCount,
        communityCount,
        questionOfDay: QUESTION_OF_DAY,
    };
};