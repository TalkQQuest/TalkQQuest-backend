import { findHomeSummaryData, hasCompletedMissionSince } from "../repositories/home.repository";
import { HomeSummaryResponseDto, TodayMissionDto } from "../dtos/home.dto";
import { NotFoundError } from "../../../shared/errors/common.error";
import { MissionProfileNotFoundError } from "../../mission/errors/mission.error";
import { getTodayMission } from "../../mission/services/mission.service";
import { kstDayStart, todayInKst } from "../../../shared/utils/date";

const QUESTION_OF_DAY = "오늘 누군가에게 먼저 말을 걸어본 적 있나요?";
const XP_PER_LEVEL = 100;

// 홈 카드의 오늘의 미션은 미션 화면(GET /missions/today)과 반드시 같아야 하므로 같은 진입점을 쓴다.
// getTodayMission은 그날 추천이 있으면 캐시를 그대로 돌려주고, 없을 때만 새로 뽑아 저장한다
// → 하루 중 첫 호출만 LLM을 타고 이후 홈 진입은 캐시로 끝난다.
const resolveTodayMission = async (userId: string): Promise<TodayMissionDto | null> => {
    let recommended;
    try {
        recommended = await getTodayMission(userId);
    } catch (error) {
        // 온보딩 미완료면 추천 기준 자체를 만들 수 없다. 이건 홈에서는 정상 상태이므로
        // 404로 홈 전체를 깨뜨리지 않고 카드만 비운다.
        if (error instanceof MissionProfileNotFoundError) return null;
        throw error;
    }

    // 추천 로그 저장이 실패하면 실제 미션 행도 만들지 못해 카드에서 대화를 시작할 수 없다.
    if (!recommended.missionId) return null;

    const isCompleted = await hasCompletedMissionSince(
        userId,
        recommended.missionId,
        kstDayStart(todayInKst())
    );

    return {
        id: recommended.missionId,
        title: recommended.title,
        category: recommended.category,
        difficulty: recommended.difficulty,
        estimatedMinutes: recommended.estimatedMinutes,
        rewardXp: recommended.rewardXp,
        description: recommended.description,
        isCompleted,
        isSaved: recommended.isSaved,
    };
};

export const getHomeSummary = async (userId: string): Promise<HomeSummaryResponseDto> => {
    const [{ profile, archiveCount }, todayMission] = await Promise.all([
        findHomeSummaryData(userId),
        resolveTodayMission(userId),
    ]);

    if (!profile) {
        throw new NotFoundError("사용자를 찾을 수 없습니다.");
    }

    const nextLevelXp = profile.level * XP_PER_LEVEL;

    return {
        nickname: profile.nickname,
        level: profile.level,
        currentXp: profile.xp,
        nextLevelXp,
        todayMission,
        archiveCount,
        communityCount: 0,
        questionOfDay: QUESTION_OF_DAY,
    };
};
