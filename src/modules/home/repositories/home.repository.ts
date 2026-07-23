import { prisma } from "../../../config/database";

export const findHomeSummaryData = async (userId: string) => {
    const [profile, archiveCount, todayMission] = await Promise.all([
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
        prisma.missions.findFirst({
        where: { is_template: true },
        orderBy: { created_at: "asc" },
        select: {
            id: true,
            title: true,
            category: true,
            difficulty: true,
            estimated_minutes: true,
            reward_xp: true,
        },
        }),
    ]);

    return { profile, archiveCount, todayMission };
};