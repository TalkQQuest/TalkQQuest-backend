import { findDashboardData } from "../repositories/dashboard.repository";
import { DashboardResponseDto } from "../dtos/dashboard.dto";
import { NotFoundError } from "../../../shared/errors/common.error";

export const getDashboard = async (userId: string): Promise<DashboardResponseDto> => {
    const { user, profile, badges, weeklyCompleted, weeklyRecords, recentRecords, goal } =
        await findDashboardData(userId);

    if (!user || !profile) {
        throw new NotFoundError("사용자를 찾을 수 없습니다.");
    }

    const email = user.auth_identities[0]?.email ?? null;
    const weeklyTotal = (goal?.daily_conversation_goal ?? 1) * 7;

    // 일(0)~토(6) 기준 요일별 완료 여부
    const completedDays = new Set(
        weeklyRecords
        .filter((r) => r.completed_at !== null)
        .map((r) => r.completed_at!.getDay())
    );

    const weeklyDays: boolean[] = Array(7)
        .fill(false)
        .map((_, i) => completedDays.has(i));

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
        weeklyDays,
        recentMissionSummary: recentRecords.map((r) => ({
        id: r.id,
        title: r.mission.title,
        result: r.result,
        completedAt: r.completed_at ? r.completed_at.toISOString() : null,
        })),
    };
};