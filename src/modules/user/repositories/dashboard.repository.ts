import { prisma } from "../../../config/database";

export const findDashboardData = async (userId: string) => {
    const startOfWeek = new Date();
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    const [user, profile, badges, weeklyCompleted, weeklyRecords, recentRecords, goal] = await Promise.all([
        // 유저 + 이메일
        prisma.users.findUnique({
        where: { id: userId },
        include: {
            auth_identities: {
            select: { email: true },
            take: 1,
            },
        },
        }),
        // 프로필
        prisma.user_Profiles.findUnique({
        where: { user_id: userId },
        select: {
            nickname: true,
            avatar_url: true,
            level: true,
            xp: true,
        },
        }),
        // 배지
        prisma.user_Badges.findMany({
        where: { user_id: userId },
        include: {
            badge: {
            select: { id: true, name: true, icon_url: true },
            },
        },
        }),
        // 이번 주 완료 미션 수
        prisma.mission_Records.count({
        where: {
            user_id: userId,
            status: "completed",
            completed_at: { gte: startOfWeek },
        },
        }),
        // 이번 주 완료 미션 날짜 목록
        prisma.mission_Records.findMany({
        where: {
            user_id: userId,
            status: "completed",
            completed_at: { gte: startOfWeek },
        },
        select: { completed_at: true },
        orderBy: { completed_at: "asc" },
        }),
        // 최근 미션 3개
        prisma.mission_Records.findMany({
        where: { user_id: userId, status: "completed" },
        include: {
            mission: { select: { title: true } },
        },
        orderBy: { completed_at: "desc" },
        take: 3,
        }),
        // 목표 (daily_conversation_goal)
        prisma.user_Profiles.findUnique({
        where: { user_id: userId },
        select: { daily_conversation_goal: true },
        }),
    ]);

    return { user, profile, badges, weeklyCompleted, weeklyRecords, recentRecords, goal };
};