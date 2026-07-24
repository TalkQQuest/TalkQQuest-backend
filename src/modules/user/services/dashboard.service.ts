import { findDashboardData } from "../repositories/dashboard.repository";
import { DashboardResponseDto } from "../dtos/dashboard.dto";
import { NotFoundError } from "../../../shared/errors/common.error";

export const getDashboard = async (userId: string): Promise<DashboardResponseDto> => {
    const { user, profile, badges, weeklyCompleted, recentRecords, goal } =
        await findDashboardData(userId);

    if (!user || !profile) {
        throw new NotFoundError("사용자를 찾을 수 없습니다.");
    }

    const email = user.auth_identities[0]?.email ?? null;
    const weeklyTotal = (goal?.daily_conversation_goal ?? 1) * 7;

    return {
        nickname: profile.nickname,
        email,
        avatarUrl: profile.avatar_url,
        level: profile.level,
        xp: profile.xp,
        badges: badges.map((b) => ({
        id: b.badge.id,
        name: b.badge.name,
        iconUrl: b.badge.icon_url,
        })),
        weeklyMissionStatus: {
        completed: weeklyCompleted,
        total: weeklyTotal,
        },
        recentMissionSummary: recentRecords.map((r) => ({
        id: r.id,
        title: r.mission.title,
        result: r.result,
        completedAt: r.completed_at ? r.completed_at.toISOString() : null,
        })),
    };
};