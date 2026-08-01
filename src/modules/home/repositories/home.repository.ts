import { prisma } from "../../../config/database";

export const findHomeSummaryData = async (userId: string) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

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
            description: true,
            category: true,
            difficulty: true,
            estimated_minutes: true,
            reward_xp: true,
            saves: {
            where: { user_id: userId },
            select: { id: true },
            },
            mission_records: {
            where: {
                user_id: userId,
                status: "completed",
                completed_at: { gte: today },
            },
            select: { id: true },
            },
        },
        }),
    ]);

    return { profile, archiveCount, todayMission };
};