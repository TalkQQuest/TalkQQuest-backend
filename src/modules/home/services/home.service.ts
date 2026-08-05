import { findHomeSummaryData, hasCompletedMissionSince } from "../repositories/home.repository";
import { HomeSummaryResponseDto, TodayMissionDto } from "../dtos/home.dto";
import { NotFoundError } from "../../../shared/errors/common.error";
import { logger } from "../../../config/logger";
import { MissionProfileNotFoundError } from "../../mission/errors/mission.error";
import { getTodayMission } from "../../mission/services/mission.service";
import { kstDayStart } from "../../../shared/utils/date";

const QUESTION_OF_DAY = "오늘 누군가에게 먼저 말을 걸어본 적 있나요?";
const XP_PER_LEVEL = 100;

// 홈 카드의 오늘의 미션은 미션 화면(GET /missions/today)과 반드시 같아야 하므로 같은 진입점을 쓴다.
// getTodayMission은 그날 추천이 있으면 캐시를 그대로 돌려주고, 없을 때만 새로 뽑아 저장한다
// → 하루 중 첫 호출만 LLM을 타고 이후 홈 진입은 캐시로 끝난다.
// 오늘의 미션 카드는 홈 화면의 한 조각일 뿐인데, 여기서 던진 오류가 그대로 올라가면
// 닉네임·레벨·경험치까지 함께 사라져 홈 전체가 열리지 않는다. LLM·외부 API 실패는 이미
// 템플릿 폴백이 흡수하지만 DB 오류는 그렇지 않아서, 카드 단위로 통째로 삼키고 비워 둔다.
// (온보딩 미완료는 오류가 아니라 정상 상태라 로그도 남기지 않는다.)
const resolveTodayMission = async (userId: string): Promise<TodayMissionDto | null> => {
    try {
        const recommended = await getTodayMission(userId);

        // 기준일은 추천이 속한 날(recommended.date)이어야 한다. 여기서 todayInKst()를 다시
        // 부르면 KST 자정 경계를 걸친 요청에서 추천은 어제 것인데 완료 여부만 오늘 기준으로
        // 조회돼, 어제 완료한 미션이 미완료로 보인다.
        const isCompleted = await hasCompletedMissionSince(
            userId,
            recommended.missionId,
            kstDayStart(recommended.date)
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
    } catch (error) {
        if (error instanceof MissionProfileNotFoundError) return null;
        logger.warn({ err: error, userId }, "홈 오늘의 미션 카드 생성 실패 (홈은 정상 반환)");
        return null;
    }
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
