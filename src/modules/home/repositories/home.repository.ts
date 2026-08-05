import { prisma } from "../../../config/database";

export const findHomeSummaryData = async (userId: string) => {
    const [profile, archiveCount] = await Promise.all([
        prisma.user_Profiles.findUnique({
        where: { user_id: userId },
        select: {
            nickname: true,
            level: true,
            xp: true,
        },
        }),
        prisma.archive_Items.count({
        where: { user_id: userId },
        }),
    ]);

    return { profile, archiveCount };
};

// 오늘의 미션 카드의 "완료" 표시용. 오늘의 미션 자체는 미션 모듈의 추천(getTodayMission)에서 오고,
// 완료 여부만 여기서 조회한다. dayStart는 KST 자정에 해당하는 실제 순간이어야 한다.
export const hasCompletedMissionSince = async (
    userId: string,
    missionId: string,
    dayStart: Date
): Promise<boolean> => {
    const record = await prisma.mission_Records.findFirst({
        where: {
            user_id: userId,
            mission_id: missionId,
            status: "completed",
            completed_at: { gte: dayStart },
        },
        select: { id: true },
    });
    return !!record;
};
