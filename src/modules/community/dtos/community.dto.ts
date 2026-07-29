import { z } from "zod";

export type MyJoinStatus = "none" | "pending" | "waitlisted" | "approved" | "rejected";
export type JoinRequestStatus = "pending" | "waitlisted" | "approved" | "rejected";

// GET /communities
export interface SearchCommunitiesQueryDto {
    keyword?: string;
    category?: string;
    region?: string;
    date?: string;
    sort?: "latest" | "popular" | "closingSoon";
    page?: number;
    size?: number;
}

export const searchCommunitiesQuerySchema = z.object({
    keyword: z.string().optional(),
    category: z.string().optional(),
    region: z.string().optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    sort: z.enum(["latest", "popular", "closingSoon"]).optional(),
    page: z.coerce.number().int().positive().optional(),
    size: z.coerce.number().int().positive().max(100).optional(),
}) satisfies z.ZodType<SearchCommunitiesQueryDto>;

export interface CommunityListItemDto {
    id: string;
    name: string;
    category: string | null;
    region: string | null;
    currentMembers: number;
    capacity: number;
    startedAt: string | null;
    coverImageUrl: string | null;
    isBookmarked: boolean;
}

export interface SearchCommunitiesResponseDto {
    totalCount: number;
    items: CommunityListItemDto[];
}

// GET /communities/{communityId}
export interface CommunityDetailResponseDto {
    id: string;
    name: string;
    description: string | null;
    category: string | null;
    region: string | null;
    address: string | null;
    startedAt: string | null;
    endedAt: string | null;
    capacity: number;
    currentMembers: number;
    coverImageUrl: string | null;
    hostNickname: string | null;
    tags: string[];
    isBookmarked: boolean;
    myStatus: MyJoinStatus;
    myWaitlistOrder: number | null;
}

// POST /communities
export interface CreateCommunityRequestDto {
    category: string;
    title: string;
    address: string;
    startedAt: string;
    endedAt: string;
    capacity: number;
    description: string;
    coverImageUrl?: string;
    tags?: string[];
}

export const createCommunityRequestSchema = z.object({
    category: z.string().min(1, "카테고리를 입력해주세요."),
    title: z.string().trim().min(1, "모임 제목을 입력해주세요."),
    address: z.string().min(1, "상세 주소를 입력해주세요."),
    startedAt: z.string().datetime({ offset: true, message: "startedAt은 ISO 8601 형식이어야 합니다" }),
    endedAt: z.string().datetime({ offset: true, message: "endedAt은 ISO 8601 형식이어야 합니다" }),
    capacity: z.number().int().positive(),
    description: z.string().min(1, "설명을 입력해주세요."),
    coverImageUrl: z.union([z.string().url(), z.literal("")]).optional(),
    tags: z.array(z.string()).optional(),
}) satisfies z.ZodType<CreateCommunityRequestDto>;

// PATCH /communities/{communityId} — 전 필드 선택
export interface UpdateCommunityRequestDto {
    category?: string;
    title?: string;
    address?: string;
    startedAt?: string;
    endedAt?: string;
    capacity?: number;
    description?: string;
    coverImageUrl?: string;
    tags?: string[];
}

export const updateCommunityRequestSchema = z.object({
    category: z.string().min(1).optional(),
    title: z.string().trim().min(1).optional(),
    address: z.string().min(1).optional(),
    startedAt: z.string().datetime({ offset: true }).optional(),
    endedAt: z.string().datetime({ offset: true }).optional(),
    capacity: z.number().int().positive().optional(),
    description: z.string().min(1).optional(),
    coverImageUrl: z.union([z.string().url(), z.literal("")]).optional(),
    tags: z.array(z.string()).optional(),
}) satisfies z.ZodType<UpdateCommunityRequestDto>;

export interface SaveCommunityResponseDto {
    id: string;
    status: "draft" | "open" | "closed";
}

// POST /communities/{communityId}/publish
export interface PublishCommunityResponseDto {
    id: string;
    status: "open";
    publishedAt: string;
}

// POST /communities/{communityId}/join-requests
export interface JoinRequestBodyDto {
    message: string;
}

export const joinRequestBodySchema = z.object({
    message: z.string().trim().min(1, "메세지를 입력해주세요."),
}) satisfies z.ZodType<JoinRequestBodyDto>;

export interface JoinRequestResponseDto {
    requestId: string;
    status: "pending" | "waitlisted";
    waitlistOrder: number | null;
}

// GET /communities/{communityId}/join-requests
export interface JoinRequestListItemDto {
    requestId: string;
    userNickname: string | null;
    message: string | null;
    status: JoinRequestStatus;
    waitlistOrder: number | null;
    createdAt: string;
}

export interface JoinRequestListResponseDto {
    items: JoinRequestListItemDto[];
}

// POST .../approve, POST .../reject
export interface JoinRequestDecisionResponseDto {
    requestId: string;
    status: "approved" | "rejected";
}

// PATCH /communities/{communityId}/waitlist/order
export interface WaitlistOrderRequestDto {
    orderedRequestIds: string[];
}

export const waitlistOrderRequestSchema = z.object({
    orderedRequestIds: z.array(z.string().uuid()).min(1, "대기열 ID 목록이 필요합니다."),
}) satisfies z.ZodType<WaitlistOrderRequestDto>;

export interface WaitlistOrderResponseDto {
    updated: true;
}

// DELETE /communities/{communityId}/me
export interface LeaveOrCancelResponseDto {
    communityId: string;
    previousStatus: "pending" | "waitlisted" | "approved";
}

// POST/DELETE /communities/{communityId}/bookmark
export interface BookmarkResponseDto {
    communityId: string;
    isBookmarked: boolean;
}

// GET /communities/me
export interface MyCommunitiesQueryDto {
    tab: "joined" | "hosting" | "bookmarked";
}

export const myCommunitiesQuerySchema = z.object({
    tab: z.enum(["joined", "hosting", "bookmarked"], {
        errorMap: () => ({ message: "tab 값이 올바르지 않습니다." }),
    }),
}) satisfies z.ZodType<MyCommunitiesQueryDto>;

export interface MyCommunityItemDto {
    id: string;
    name: string;
    category: string | null;
    region: string | null;
    currentMembers: number;
    capacity: number;
    startedAt: string | null;
    coverImageUrl: string | null;
    myStatus?: "pending" | "waitlisted" | "approved";
}

export interface MyCommunitiesResponseDto {
    items: MyCommunityItemDto[];
}

// GET /communities/recommendations
export interface RecommendationItemDto {
    id: string;
    name: string;
    category: string | null;
    currentMembers: number;
    capacity: number;
}

export interface RecommendationsResponseDto {
    items: RecommendationItemDto[];
}

// GET /communities/{communityId}/chat-preview
export interface ChatPreviewMessageDto {
    userNickname: string | null;
    content: string;
    createdAt: string;
}

export interface ChatPreviewResponseDto {
    communityId: string;
    recentMessages: ChatPreviewMessageDto[];
    participantCount: number;
}
