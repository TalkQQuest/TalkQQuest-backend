// modules/community/services/community.service.ts
import { prisma } from "../../../config/database";
import * as communityRepository from "../repositories/community.repository";
import {
    CommunityNotFoundError,
    NotTheHostError,
    JoinClosedError,
    AlreadyRequestedError,
    RequestNotFoundError,
    CommunityFullError,
    HostCannotLeaveError,
    NotAMemberError,
    AlreadyBookmarkedError,
    NotBookmarkedError,
    NotApprovedError,
} from "../errors/community.error";
import { NotFoundError } from "../../../shared/errors/common.error";
import { broadcastSystemMessage } from "../realtime/chat.socket";
import {
    BookmarkResponseDto,
    ChatPreviewResponseDto,
    CommunityDetailResponseDto,
    CommunityListItemDto,
    CreateCommunityRequestDto,
    JoinRequestBodyDto,
    JoinRequestDecisionResponseDto,
    JoinRequestListResponseDto,
    JoinRequestResponseDto,
    LeaveOrCancelResponseDto,
    MyCommunitiesResponseDto,
    PublishCommunityResponseDto,
    RecommendationsResponseDto,
    SaveCommunityResponseDto,
    SearchCommunitiesQueryDto,
    SearchCommunitiesResponseDto,
    UpdateCommunityRequestDto,
    WaitlistOrderRequestDto,
    WaitlistOrderResponseDto,
} from "../dtos/community.dto";

const DEFAULT_PAGE = 1;
const DEFAULT_SIZE = 20;
const CHAT_PREVIEW_LIMIT = 5;
const RECOMMENDATION_LIMIT = 5;

// 시/도·시/군/구 수준까지만 뽑아 region으로 쓴다 ("경기도 성남시 분당구 정자동 178-1" → "성남시").
// 정확한 행정구역 파싱 라이브러리는 아니고, 두 번째 토큰(시/군/구)을 쓰는 단순 규칙이다.
const extractRegion = (address: string): string | null => {
    const tokens = address.trim().split(/\s+/);
    return tokens[1] ?? tokens[0] ?? null;
};

const toListItemDto = (
    row: { id: string; name: string; category: string | null; region: string | null; current_members: number; capacity: number; started_at: Date | null; cover_image_url: string | null },
    isBookmarked: boolean
): CommunityListItemDto => ({
    id: row.id,
    name: row.name,
    category: row.category,
    region: row.region,
    currentMembers: row.current_members,
    capacity: row.capacity,
    startedAt: row.started_at?.toISOString() ?? null,
    coverImageUrl: row.cover_image_url,
    isBookmarked,
});

export const searchCommunities = async (
    userId: string,
    query: SearchCommunitiesQueryDto
): Promise<SearchCommunitiesResponseDto> => {
    await communityRepository.closeExpiredCommunities();

    const params = {
        keyword: query.keyword,
        category: query.category,
        region: query.region,
        sort: query.sort ?? ("latest" as const),
        page: query.page ?? DEFAULT_PAGE,
        size: query.size ?? DEFAULT_SIZE,
    };

    const [rows, totalCount] = await Promise.all([
        communityRepository.searchCommunities(params),
        communityRepository.countSearchCommunities(params),
    ]);

    const bookmarked = await communityRepository.findBookmarkedIds(userId, rows.map((r) => r.id));
    const bookmarkedIds = new Set(bookmarked.map((b) => b.community_id));

    return {
        totalCount,
        items: rows.map((row) => toListItemDto(row, bookmarkedIds.has(row.id))),
    };
};

export const getCommunityDetail = async (
    userId: string,
    communityId: string
): Promise<CommunityDetailResponseDto> => {
    const community = await communityRepository.findCommunityByIdWithHost(communityId);
    if (!community) throw new CommunityNotFoundError();

    const [bookmark, joinRequest] = await Promise.all([
        communityRepository.findBookmark(communityId, userId),
        communityRepository.findJoinRequest(communityId, userId),
    ]);

    let myStatus: CommunityDetailResponseDto["myStatus"] = "none";
    let myWaitlistOrder: number | null = null;
    if (joinRequest && joinRequest.status !== "cancelled") {
        myStatus = joinRequest.status;
        myWaitlistOrder = joinRequest.status === "waitlisted" ? joinRequest.waitlist_order : null;
    }

    return {
        id: community.id,
        name: community.name,
        description: community.description,
        category: community.category,
        region: community.region,
        address: community.address,
        startedAt: community.started_at?.toISOString() ?? null,
        endedAt: community.ended_at?.toISOString() ?? null,
        capacity: community.capacity,
        currentMembers: community.current_members,
        coverImageUrl: community.cover_image_url,
        hostNickname: community.host.name,
        tags: (community.tags as string[] | null) ?? [],
        isBookmarked: !!bookmark,
        myStatus,
        myWaitlistOrder,
    };
};

export const createCommunity = async (
    userId: string,
    body: CreateCommunityRequestDto
): Promise<SaveCommunityResponseDto> => {
    const community = await prisma.$transaction(async (tx) => {
        const created = await tx.communities.create({
            data: {
                host_user_id: userId,
                name: body.title,
                description: body.description,
                category: body.category,
                address: body.address,
                region: extractRegion(body.address),
                capacity: body.capacity,
                started_at: new Date(body.startedAt),
                ended_at: new Date(body.endedAt),
                cover_image_url: body.coverImageUrl,
                tags: body.tags,
                current_members: 1,
            },
        });
        await communityRepository.createMember(created.id, userId, "host", tx);
        return created;
    });

    return { id: community.id, status: community.status };
};

export const updateCommunity = async (
    userId: string,
    communityId: string,
    body: UpdateCommunityRequestDto
): Promise<SaveCommunityResponseDto> => {
    const community = await communityRepository.findCommunityById(communityId);
    if (!community) throw new CommunityNotFoundError();
    if (community.host_user_id !== userId) throw new NotTheHostError("호스트만 수정할 수 있습니다.");

    const updated = await communityRepository.updateCommunity(communityId, {
        ...(body.category && { category: body.category }),
        ...(body.title && { name: body.title }),
        ...(body.address && { address: body.address, region: extractRegion(body.address) }),
        ...(body.startedAt && { started_at: new Date(body.startedAt) }),
        ...(body.endedAt && { ended_at: new Date(body.endedAt) }),
        ...(body.capacity !== undefined && { capacity: body.capacity }),
        ...(body.description && { description: body.description }),
        ...(body.coverImageUrl && { cover_image_url: body.coverImageUrl }),
        ...(body.tags && { tags: body.tags }),
    });

    return { id: updated.id, status: updated.status };
};

export const publishCommunity = async (
    userId: string,
    communityId: string
): Promise<PublishCommunityResponseDto> => {
    const community = await communityRepository.findCommunityById(communityId);
    if (!community) throw new CommunityNotFoundError();
    if (community.host_user_id !== userId) throw new NotTheHostError("호스트만 게시할 수 있습니다.");

    const updated = await communityRepository.updateCommunity(communityId, { status: "open" });
    return { id: updated.id, status: "open", publishedAt: new Date().toISOString() };
};

// #114 — 정원이 가득 차도 신청 자체는 받고 자동으로 waitlisted 처리한다 (호스트 관리 편의를 위해 대기 등록을 별도 API로 분리하지 않음).
export const createJoinRequest = async (
    userId: string,
    communityId: string,
    body: JoinRequestBodyDto
): Promise<JoinRequestResponseDto> => {
    const community = await communityRepository.findCommunityById(communityId);
    if (!community) throw new CommunityNotFoundError();
    if (community.status !== "open") throw new JoinClosedError();

    const existing = await communityRepository.findJoinRequest(communityId, userId);
    if (existing && ["pending", "waitlisted", "approved"].includes(existing.status)) {
        throw new AlreadyRequestedError();
    }

    const isFull = community.current_members >= community.capacity;
    const status = isFull ? ("waitlisted" as const) : ("pending" as const);
    const waitlistOrder = isFull ? (await communityRepository.countWaitlisted(communityId)) + 1 : null;

    const created = existing
        ? await communityRepository.renewJoinRequest(existing.id, body.message, status, waitlistOrder)
        : await communityRepository.createJoinRequest(communityId, userId, body.message, status, waitlistOrder);

    return { requestId: created.id, status, waitlistOrder };
};

export const listJoinRequests = async (
    userId: string,
    communityId: string,
    status?: "pending" | "waitlisted" | "approved" | "rejected"
): Promise<JoinRequestListResponseDto> => {
    const community = await communityRepository.findCommunityById(communityId);
    if (!community) throw new CommunityNotFoundError();
    if (community.host_user_id !== userId) throw new NotTheHostError("호스트만 조회할 수 있습니다.");

    const rows = await communityRepository.listJoinRequests(communityId, status);
    return {
        items: rows.map((row) => ({
            requestId: row.id,
            userNickname: row.user.name,
            message: row.message,
            status: row.status as "pending" | "waitlisted" | "approved" | "rejected",
            waitlistOrder: row.waitlist_order,
            createdAt: row.created_at.toISOString(),
        })),
    };
};

export const approveJoinRequest = async (
    userId: string,
    communityId: string,
    requestId: string
): Promise<JoinRequestDecisionResponseDto> => {
    const community = await communityRepository.findCommunityById(communityId);
    if (!community) throw new CommunityNotFoundError();
    if (community.host_user_id !== userId) throw new NotTheHostError("호스트만 처리할 수 있습니다.");

    const request = await communityRepository.findJoinRequestById(requestId);
    if (!request || request.community_id !== communityId) throw new RequestNotFoundError();
    if (community.current_members >= community.capacity) throw new CommunityFullError();

    await prisma.$transaction(async (tx) => {
        await communityRepository.createMember(communityId, request.user_id, "member", tx);
        await communityRepository.updateJoinRequestStatus(requestId, "approved", tx);
        await tx.communities.update({
            where: { id: communityId },
            data: { current_members: { increment: 1 } },
        });
    });

    // #115 — 승인 즉시 채팅방에 입장 시스템 메시지를 남긴다. 채팅 자체의 핵심 흐름은 아니라
    // 실패해도 승인 자체는 이미 끝난 상태이므로 여기서 막지 않는다.
    await broadcastSystemMessage(communityId, `${request.user.name}님이 입장했습니다.`);

    return { requestId, status: "approved" };
};

export const rejectJoinRequest = async (
    userId: string,
    communityId: string,
    requestId: string
): Promise<JoinRequestDecisionResponseDto> => {
    const community = await communityRepository.findCommunityById(communityId);
    if (!community) throw new CommunityNotFoundError();
    if (community.host_user_id !== userId) throw new NotTheHostError("호스트만 처리할 수 있습니다.");

    const request = await communityRepository.findJoinRequestById(requestId);
    if (!request || request.community_id !== communityId) throw new RequestNotFoundError();

    await communityRepository.updateJoinRequestStatus(requestId, "rejected");
    return { requestId, status: "rejected" };
};

export const reorderWaitlist = async (
    userId: string,
    communityId: string,
    body: WaitlistOrderRequestDto
): Promise<WaitlistOrderResponseDto> => {
    const community = await communityRepository.findCommunityById(communityId);
    if (!community) throw new CommunityNotFoundError();
    if (community.host_user_id !== userId) throw new NotTheHostError("호스트만 변경할 수 있습니다.");

    await communityRepository.reorderWaitlist(body.orderedRequestIds);
    return { updated: true };
};

// #114 — 승인 전(pending/waitlisted) 신청 취소와 승인 후(approved) 탈퇴를 프론트가 상태 구분 없이 호출할 수 있도록 하나로 통합한다.
export const leaveOrCancel = async (
    userId: string,
    communityId: string
): Promise<LeaveOrCancelResponseDto> => {
    const community = await communityRepository.findCommunityById(communityId);
    if (!community) throw new CommunityNotFoundError();
    if (community.host_user_id === userId) throw new HostCannotLeaveError();

    const member = await communityRepository.findMember(communityId, userId);
    if (member) {
        await prisma.$transaction(async (tx) => {
            await communityRepository.deleteMember(communityId, userId, tx);
            const joinRequest = await communityRepository.findJoinRequest(communityId, userId);
            if (joinRequest) await communityRepository.updateJoinRequestStatus(joinRequest.id, "cancelled", tx);
            await tx.communities.update({
                where: { id: communityId },
                data: { current_members: { decrement: 1 } },
            });
        });
        return { communityId, previousStatus: "approved" };
    }

    const joinRequest = await communityRepository.findJoinRequest(communityId, userId);
    if (joinRequest && ["pending", "waitlisted"].includes(joinRequest.status)) {
        await communityRepository.updateJoinRequestStatus(joinRequest.id, "cancelled");
        return { communityId, previousStatus: joinRequest.status as "pending" | "waitlisted" };
    }

    throw new NotAMemberError();
};

export const addBookmark = async (userId: string, communityId: string): Promise<BookmarkResponseDto> => {
    const community = await communityRepository.findCommunityById(communityId);
    if (!community) throw new CommunityNotFoundError();

    const existing = await communityRepository.findBookmark(communityId, userId);
    if (existing) throw new AlreadyBookmarkedError();

    await communityRepository.createBookmark(communityId, userId);
    return { communityId, isBookmarked: true };
};

export const removeBookmark = async (userId: string, communityId: string): Promise<BookmarkResponseDto> => {
    const existing = await communityRepository.findBookmark(communityId, userId);
    if (!existing) throw new NotBookmarkedError();

    await communityRepository.deleteBookmark(communityId, userId);
    return { communityId, isBookmarked: false };
};

export const getMyCommunities = async (
    userId: string,
    tab: "joined" | "hosting" | "bookmarked"
): Promise<MyCommunitiesResponseDto> => {
    if (tab === "hosting") {
        const rows = await prisma.communities.findMany({
            where: { host_user_id: userId },
            orderBy: { created_at: "desc" },
        });
        return { items: rows.map((row) => toListItemDto(row, false)) };
    }

    if (tab === "bookmarked") {
        const rows = await communityRepository.findBookmarksByUser(userId);
        return { items: rows.map((row) => toListItemDto(row.community, true)) };
    }

    // tab === "joined": 승인된 멤버십 + 아직 대기 중인 신청까지 함께 보여준다.
    const [memberships, pendingRequests] = await Promise.all([
        communityRepository.findMembersByUser(userId),
        communityRepository.findJoinRequestsByUser(userId, ["pending", "waitlisted"]),
    ]);

    const memberItems = memberships.map((m) => ({
        ...toListItemDto(m.community, false),
        myStatus: "approved" as const,
    }));
    const pendingItems = pendingRequests.map((r) => ({
        ...toListItemDto(r.community, false),
        myStatus: r.status as "pending" | "waitlisted",
    }));

    return { items: [...memberItems, ...pendingItems] };
};

export const getRecommendations = async (communityId: string): Promise<RecommendationsResponseDto> => {
    const community = await communityRepository.findCommunityById(communityId);
    if (!community) throw new CommunityNotFoundError();

    const rows = await prisma.communities.findMany({
        where: {
            id: { not: communityId },
            status: "open",
            ...(community.category && { category: community.category }),
        },
        orderBy: { created_at: "desc" },
        take: RECOMMENDATION_LIMIT,
    });

    return {
        items: rows.map((row) => ({
            id: row.id,
            name: row.name,
            category: row.category,
            currentMembers: row.current_members,
            capacity: row.capacity,
        })),
    };
};

export const getChatPreview = async (communityId: string): Promise<ChatPreviewResponseDto> => {
    const community = await communityRepository.findCommunityById(communityId);
    if (!community) throw new CommunityNotFoundError();

    const rows = await communityRepository.findRecentChatMessages(communityId, CHAT_PREVIEW_LIMIT);

    return {
        communityId,
        recentMessages: rows.reverse().map((row) => ({
            userNickname: row.user?.name ?? null,
            content: row.content,
            createdAt: row.created_at.toISOString(),
        })),
        participantCount: community.current_members,
    };
};

export const addCalendarEvent = async (userId: string, communityId: string) => {
    const community = await communityRepository.findCommunityById(communityId);
    if (!community) throw new CommunityNotFoundError();

    const member = await communityRepository.findMember(communityId, userId);
    if (!member) throw new NotApprovedError();

    if (!community.started_at) throw new NotFoundError("모임 일정이 아직 없습니다.");

    const event = await communityRepository.createCalendarEvent({
        user_id: userId,
        community_id: communityId,
        title: community.name,
        started_at: community.started_at,
        ended_at: community.ended_at,
    });

    return { eventId: event.id, title: event.title, startedAt: event.started_at.toISOString() };
};
