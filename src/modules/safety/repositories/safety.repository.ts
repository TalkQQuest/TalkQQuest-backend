import { prisma } from "../../../config/database";

export const findBlockedUsersByUserId = (userId: string) =>
    prisma.blocked_Users.findMany({
        where: { user_id: userId },
        include: {
        blocked_user: {
            include: {
            user_profile: {
                select: {
                nickname: true,
                avatar_url: true,
                },
            },
            },
        },
        },
        orderBy: { created_at: "desc" },
    });

    export const findUserById = (userId: string) =>
    prisma.users.findUnique({ where: { id: userId } });

    export const findBlockRecord = (userId: string, blockedUserId: string) =>
    prisma.blocked_Users.findUnique({
        where: { user_id_blocked_user_id: { user_id: userId, blocked_user_id: blockedUserId } },
    });

    export const createBlockRecord = (userId: string, blockedUserId: string) =>
    prisma.blocked_Users.create({
        data: { user_id: userId, blocked_user_id: blockedUserId },
    });

    export const deleteBlockRecord = (userId: string, blockedUserId: string) =>
    prisma.blocked_Users.delete({
        where: { user_id_blocked_user_id: { user_id: userId, blocked_user_id: blockedUserId } },
    });