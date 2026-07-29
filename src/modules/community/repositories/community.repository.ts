// modules/community/repositories/community.repository.ts
import { Prisma } from "@prisma/client";
import { prisma } from "../../../config/database";

type TxClient = Prisma.TransactionClient;
type Db = typeof prisma | TxClient;

// ----- Communities -----

export const createCommunity = (
    hostUserId: string,
    data: {
        category: string;
        name: string;
        address: string;
        started_at: Date;
        ended_at: Date;
        capacity: number;
        description: string;
        cover_image_url?: string;
        tags?: string[];
    }
) =>
    prisma.communities.create({
        data: {
            host_user_id: hostUserId,
            name: data.name,
            description: data.description,
            category: data.category,
            address: data.address,
            capacity: data.capacity,
            started_at: data.started_at,
            ended_at: data.ended_at,
            cover_image_url: data.cover_image_url,
            tags: data.tags,
            current_members: 0,
        },
    });

export const updateCommunity = (
    communityId: string,
    data: Prisma.CommunitiesUpdateInput
) => prisma.communities.update({ where: { id: communityId }, data });

export const findCommunityById = (communityId: string) =>
    prisma.communities.findUnique({ where: { id: communityId } });

export const findCommunityByIdWithHost = (communityId: string) =>
    prisma.communities.findUnique({
        where: { id: communityId },
        include: { host: { select: { name: true } } },
    });

export interface SearchCommunitiesParams {
    keyword?: string;
    category?: string;
    region?: string;
    sort: "latest" | "popular" | "closingSoon";
    page: number;
    size: number;
}

const buildSearchWhere = (params: SearchCommunitiesParams): Prisma.CommunitiesWhereInput => ({
    status: "open",
    ...(params.keyword && { name: { contains: params.keyword } }),
    ...(params.category && { category: params.category }),
    ...(params.region && { region: params.region }),
});

const SORT_TO_ORDER_BY: Record<SearchCommunitiesParams["sort"], Prisma.CommunitiesOrderByWithRelationInput> = {
    latest: { created_at: "desc" },
    popular: { current_members: "desc" },
    closingSoon: { started_at: "asc" },
};

export const searchCommunities = (params: SearchCommunitiesParams) =>
    prisma.communities.findMany({
        where: buildSearchWhere(params),
        orderBy: SORT_TO_ORDER_BY[params.sort],
        skip: (params.page - 1) * params.size,
        take: params.size,
    });

export const countSearchCommunities = (params: SearchCommunitiesParams) =>
    prisma.communities.count({ where: buildSearchWhere(params) });

// 종료 일시가 지난 open 모임을 closed로 일괄 전환한다 (조회 시점에 lazy하게 반영).
export const closeExpiredCommunities = () =>
    prisma.communities.updateMany({
        where: { status: "open", ended_at: { lt: new Date() } },
        data: { status: "closed" },
    });

// ----- Community_Members -----

export const createMember = (
    communityId: string,
    userId: string,
    role: "host" | "member",
    tx: Db = prisma
) => tx.community_Members.create({ data: { community_id: communityId, user_id: userId, role } });

export const findMember = (communityId: string, userId: string) =>
    prisma.community_Members.findUnique({
        where: { community_id_user_id: { community_id: communityId, user_id: userId } },
    });

export const deleteMember = (communityId: string, userId: string, tx: Db = prisma) =>
    tx.community_Members.delete({
        where: { community_id_user_id: { community_id: communityId, user_id: userId } },
    });

export const findMembersByUser = (userId: string) =>
    prisma.community_Members.findMany({
        where: { user_id: userId, role: "member" },
        include: { community: true },
        orderBy: { joined_at: "desc" },
    });

// ----- Community_Join_Requests -----

export const findJoinRequest = (communityId: string, userId: string) =>
    prisma.community_Join_Requests.findUnique({
        where: { community_id_user_id: { community_id: communityId, user_id: userId } },
    });

export const findJoinRequestById = (requestId: string) =>
    prisma.community_Join_Requests.findUnique({
        where: { id: requestId },
        include: { user: { select: { name: true } } },
    });

export const countWaitlisted = (communityId: string) =>
    prisma.community_Join_Requests.count({ where: { community_id: communityId, status: "waitlisted" } });

export const createJoinRequest = (
    communityId: string,
    userId: string,
    message: string,
    status: "pending" | "waitlisted",
    waitlistOrder: number | null
) =>
    prisma.community_Join_Requests.create({
        data: { community_id: communityId, user_id: userId, message, status, waitlist_order: waitlistOrder },
    });

// 예전에 취소/거절됐던 신청을 재신청 시 같은 row를 재사용한다 (community_id+user_id unique 제약 때문).
export const renewJoinRequest = (
    requestId: string,
    message: string,
    status: "pending" | "waitlisted",
    waitlistOrder: number | null
) =>
    prisma.community_Join_Requests.update({
        where: { id: requestId },
        data: { message, status, waitlist_order: waitlistOrder },
    });

export const updateJoinRequestStatus = (
    requestId: string,
    status: "approved" | "rejected" | "cancelled",
    tx: Db = prisma
) =>
    tx.community_Join_Requests.update({
        where: { id: requestId },
        data: { status, waitlist_order: null },
    });

export const listJoinRequests = (communityId: string, status?: "pending" | "waitlisted" | "approved" | "rejected") =>
    prisma.community_Join_Requests.findMany({
        where: { community_id: communityId, ...(status && { status }) },
        include: { user: { select: { name: true } } },
        orderBy: [{ waitlist_order: "asc" }, { created_at: "asc" }],
    });

export const findJoinRequestsByUser = (userId: string, statuses: ("pending" | "waitlisted")[]) =>
    prisma.community_Join_Requests.findMany({
        where: { user_id: userId, status: { in: statuses } },
        include: { community: true },
        orderBy: { created_at: "desc" },
    });

export const reorderWaitlist = (orderedRequestIds: string[]) =>
    prisma.$transaction(
        orderedRequestIds.map((requestId, index) =>
            prisma.community_Join_Requests.update({
                where: { id: requestId },
                data: { waitlist_order: index + 1 },
            })
        )
    );

// ----- Community_Bookmarks -----

export const findBookmark = (communityId: string, userId: string) =>
    prisma.community_Bookmarks.findUnique({
        where: { community_id_user_id: { community_id: communityId, user_id: userId } },
    });

export const createBookmark = (communityId: string, userId: string) =>
    prisma.community_Bookmarks.create({ data: { community_id: communityId, user_id: userId } });

export const deleteBookmark = (communityId: string, userId: string) =>
    prisma.community_Bookmarks.delete({
        where: { community_id_user_id: { community_id: communityId, user_id: userId } },
    });

export const findBookmarksByUser = (userId: string) =>
    prisma.community_Bookmarks.findMany({
        where: { user_id: userId },
        include: { community: true },
        orderBy: { created_at: "desc" },
    });

export const findBookmarkedIds = (userId: string, communityIds: string[]) =>
    prisma.community_Bookmarks.findMany({
        where: { user_id: userId, community_id: { in: communityIds } },
        select: { community_id: true },
    });

// ----- Chat_Messages (미리보기용) -----

export const findRecentChatMessages = (communityId: string, take: number) =>
    prisma.chat_Messages.findMany({
        where: { community_id: communityId },
        include: { user: { select: { name: true } } },
        orderBy: { created_at: "desc" },
        take,
    });

// ----- Calendar_Events -----

export const createCalendarEvent = (data: {
    user_id: string;
    community_id: string;
    title: string;
    started_at: Date;
    ended_at: Date | null;
}) => prisma.calendar_Events.create({ data });
