import { Body, Controller, Delete, Get, Middlewares, Patch, Path, Post, Query, Request, Response, Route, Security, Tags } from "tsoa";
import type { Request as ExpressRequest } from "express";
import { authorizeUser } from "../../../middlewares/auth";
import { validate } from "../../../middlewares/validator";
import { ValidationError } from "../../../shared/errors/common.error";
import { success, ApiResponse } from "../../../shared/utils/response";
import {
    BookmarkResponseDto,
    ChatPreviewResponseDto,
    CommunityDetailResponseDto,
    createCommunityRequestSchema,
    CreateCommunityRequestDto,
    JoinRequestBodyDto,
    joinRequestBodySchema,
    JoinRequestDecisionResponseDto,
    JoinRequestListResponseDto,
    JoinRequestResponseDto,
    LeaveOrCancelResponseDto,
    MyCommunitiesResponseDto,
    myCommunitiesQuerySchema,
    PublishCommunityResponseDto,
    RecommendationsResponseDto,
    SaveCommunityResponseDto,
    searchCommunitiesQuerySchema,
    SearchCommunitiesResponseDto,
    UpdateCommunityRequestDto,
    updateCommunityRequestSchema,
    WaitlistOrderRequestDto,
    waitlistOrderRequestSchema,
    WaitlistOrderResponseDto,
} from "../dtos/community.dto";
import * as communityService from "../services/community.service";

@Route("communities")
@Tags("Community")
export class CommunityController extends Controller {
    /**
     * @summary 커뮤니티 목록/필터/검색
     */
    @Get()
    @Security("bearerAuth")
    @Middlewares(authorizeUser())
    @Response(401, "UNAUTHORIZED")
    public async search(
        @Request() req: ExpressRequest,
        @Query() keyword?: string,
        @Query() category?: string,
        @Query() region?: string,
        @Query() date?: string,
        @Query() sort?: "latest" | "popular" | "closingSoon",
        @Query() page?: number,
        @Query() size?: number
    ): Promise<ApiResponse<SearchCommunitiesResponseDto>> {
        const parsed = searchCommunitiesQuerySchema.safeParse({ keyword, category, region, date, sort, page, size });
        if (!parsed.success) {
            throw new ValidationError("잘못된 검색 조건입니다.", parsed.error.issues);
        }
        const result = await communityService.searchCommunities(req.user!.id, parsed.data);
        return success(result);
    }

    /**
     * @summary 유사 모임 추천
     */
    @Get("recommendations")
    @Security("bearerAuth")
    @Middlewares(authorizeUser())
    @Response(401, "UNAUTHORIZED")
    public async getRecommendations(
        @Query() communityId: string
    ): Promise<ApiResponse<RecommendationsResponseDto>> {
        const result = await communityService.getRecommendations(communityId);
        return success(result);
    }

    /**
     * @summary 내 모임 조회 (참여중/내가 만든/저장)
     */
    @Get("me")
    @Security("bearerAuth")
    @Middlewares(authorizeUser())
    @Response(400, "VALIDATION_ERROR")
    @Response(401, "UNAUTHORIZED")
    public async getMyCommunities(
        @Request() req: ExpressRequest,
        @Query() tab: "joined" | "hosting" | "bookmarked"
    ): Promise<ApiResponse<MyCommunitiesResponseDto>> {
        const parsed = myCommunitiesQuerySchema.safeParse({ tab });
        if (!parsed.success) {
            throw new ValidationError("tab 값이 올바르지 않습니다.", parsed.error.issues);
        }
        const result = await communityService.getMyCommunities(req.user!.id, parsed.data.tab);
        return success(result);
    }

    /**
     * @summary 커뮤니티 상세
     */
    @Get("{communityId}")
    @Security("bearerAuth")
    @Middlewares(authorizeUser())
    @Response(401, "UNAUTHORIZED")
    @Response(404, "COMMUNITY_NOT_FOUND")
    public async getDetail(
        @Request() req: ExpressRequest,
        @Path() communityId: string
    ): Promise<ApiResponse<CommunityDetailResponseDto>> {
        const result = await communityService.getCommunityDetail(req.user!.id, communityId);
        return success(result);
    }

    /**
     * @summary 채팅방 미리보기
     */
    @Get("{communityId}/chat-preview")
    @Security("bearerAuth")
    @Middlewares(authorizeUser())
    @Response(401, "UNAUTHORIZED")
    @Response(404, "COMMUNITY_NOT_FOUND")
    public async getChatPreview(
        @Path() communityId: string
    ): Promise<ApiResponse<ChatPreviewResponseDto>> {
        const result = await communityService.getChatPreview(communityId);
        return success(result);
    }

    /**
     * @summary 모임 생성 임시 저장
     */
    @Post()
    @Security("bearerAuth")
    @Middlewares(authorizeUser(), validate(createCommunityRequestSchema))
    @Response(400, "VALIDATION_ERROR")
    @Response(401, "UNAUTHORIZED")
    public async create(
        @Request() req: ExpressRequest,
        @Body() body: CreateCommunityRequestDto
    ): Promise<ApiResponse<SaveCommunityResponseDto>> {
        const result = await communityService.createCommunity(req.user!.id, body);
        return success(result, "임시 저장되었습니다.");
    }

    /**
     * @summary 모임 수정
     */
    @Patch("{communityId}")
    @Security("bearerAuth")
    @Middlewares(authorizeUser(), validate(updateCommunityRequestSchema))
    @Response(400, "VALIDATION_ERROR")
    @Response(401, "UNAUTHORIZED")
    @Response(403, "NOT_THE_HOST")
    @Response(404, "COMMUNITY_NOT_FOUND")
    public async update(
        @Request() req: ExpressRequest,
        @Path() communityId: string,
        @Body() body: UpdateCommunityRequestDto
    ): Promise<ApiResponse<SaveCommunityResponseDto>> {
        const result = await communityService.updateCommunity(req.user!.id, communityId, body);
        return success(result, "수정되었습니다.");
    }

    /**
     * @summary 모임 게시
     */
    @Post("{communityId}/publish")
    @Security("bearerAuth")
    @Middlewares(authorizeUser())
    @Response(401, "UNAUTHORIZED")
    @Response(403, "NOT_THE_HOST")
    @Response(404, "COMMUNITY_NOT_FOUND")
    public async publish(
        @Request() req: ExpressRequest,
        @Path() communityId: string
    ): Promise<ApiResponse<PublishCommunityResponseDto>> {
        const result = await communityService.publishCommunity(req.user!.id, communityId);
        return success(result, "모임이 게시되었습니다.");
    }

    /**
     * @summary 커뮤니티 참여 신청
     */
    @Post("{communityId}/join-requests")
    @Security("bearerAuth")
    @Middlewares(authorizeUser(), validate(joinRequestBodySchema))
    @Response(400, "VALIDATION_ERROR")
    @Response(401, "UNAUTHORIZED")
    @Response(403, "JOIN_CLOSED")
    @Response(404, "COMMUNITY_NOT_FOUND")
    @Response(409, "ALREADY_REQUESTED")
    public async joinRequest(
        @Request() req: ExpressRequest,
        @Path() communityId: string,
        @Body() body: JoinRequestBodyDto
    ): Promise<ApiResponse<JoinRequestResponseDto>> {
        const result = await communityService.createJoinRequest(req.user!.id, communityId, body);
        const message = result.status === "waitlisted" ? "정원이 마감되어 대기 명단에 등록되었습니다." : "참여 신청이 완료되었습니다.";
        return success(result, message);
    }

    /**
     * @summary 모임 신청자 목록 조회
     */
    @Get("{communityId}/join-requests")
    @Security("bearerAuth")
    @Middlewares(authorizeUser())
    @Response(401, "UNAUTHORIZED")
    @Response(403, "NOT_THE_HOST")
    @Response(404, "COMMUNITY_NOT_FOUND")
    public async listJoinRequests(
        @Request() req: ExpressRequest,
        @Path() communityId: string,
        @Query() status?: "pending" | "waitlisted" | "approved" | "rejected"
    ): Promise<ApiResponse<JoinRequestListResponseDto>> {
        const result = await communityService.listJoinRequests(req.user!.id, communityId, status);
        return success(result);
    }

    /**
     * @summary 모임 신청자 승인
     */
    @Post("{communityId}/join-requests/{requestId}/approve")
    @Security("bearerAuth")
    @Middlewares(authorizeUser())
    @Response(401, "UNAUTHORIZED")
    @Response(403, "NOT_THE_HOST")
    @Response(404, "REQUEST_NOT_FOUND")
    @Response(409, "COMMUNITY_FULL")
    public async approve(
        @Request() req: ExpressRequest,
        @Path() communityId: string,
        @Path() requestId: string
    ): Promise<ApiResponse<JoinRequestDecisionResponseDto>> {
        const result = await communityService.approveJoinRequest(req.user!.id, communityId, requestId);
        return success(result, "신청을 승인했습니다.");
    }

    /**
     * @summary 모임 신청자 거절
     */
    @Post("{communityId}/join-requests/{requestId}/reject")
    @Security("bearerAuth")
    @Middlewares(authorizeUser())
    @Response(401, "UNAUTHORIZED")
    @Response(403, "NOT_THE_HOST")
    @Response(404, "REQUEST_NOT_FOUND")
    public async reject(
        @Request() req: ExpressRequest,
        @Path() communityId: string,
        @Path() requestId: string
    ): Promise<ApiResponse<JoinRequestDecisionResponseDto>> {
        const result = await communityService.rejectJoinRequest(req.user!.id, communityId, requestId);
        return success(result, "신청을 거절했습니다.");
    }

    /**
     * @summary 모임 대기자 순서 변경
     */
    @Patch("{communityId}/waitlist/order")
    @Security("bearerAuth")
    @Middlewares(authorizeUser(), validate(waitlistOrderRequestSchema))
    @Response(400, "VALIDATION_ERROR")
    @Response(401, "UNAUTHORIZED")
    @Response(403, "NOT_THE_HOST")
    @Response(404, "COMMUNITY_NOT_FOUND")
    public async reorderWaitlist(
        @Request() req: ExpressRequest,
        @Path() communityId: string,
        @Body() body: WaitlistOrderRequestDto
    ): Promise<ApiResponse<WaitlistOrderResponseDto>> {
        const result = await communityService.reorderWaitlist(req.user!.id, communityId, body);
        return success(result, "대기 순서가 변경되었습니다.");
    }

    /**
     * @summary 모임 탈퇴/신청 취소
     */
    @Delete("{communityId}/me")
    @Security("bearerAuth")
    @Middlewares(authorizeUser())
    @Response(401, "UNAUTHORIZED")
    @Response(403, "HOST_CANNOT_LEAVE")
    @Response(404, "NOT_A_MEMBER")
    public async leave(
        @Request() req: ExpressRequest,
        @Path() communityId: string
    ): Promise<ApiResponse<LeaveOrCancelResponseDto>> {
        const result = await communityService.leaveOrCancel(req.user!.id, communityId);
        const message = result.previousStatus === "approved" ? "모임을 탈퇴했습니다." : "신청이 취소되었습니다.";
        return success(result, message);
    }

    /**
     * @summary 모임 저장
     */
    @Post("{communityId}/bookmark")
    @Security("bearerAuth")
    @Middlewares(authorizeUser())
    @Response(401, "UNAUTHORIZED")
    @Response(404, "COMMUNITY_NOT_FOUND")
    @Response(409, "ALREADY_BOOKMARKED")
    public async bookmark(
        @Request() req: ExpressRequest,
        @Path() communityId: string
    ): Promise<ApiResponse<BookmarkResponseDto>> {
        const result = await communityService.addBookmark(req.user!.id, communityId);
        return success(result, "저장되었습니다.");
    }

    /**
     * @summary 모임 저장 해제
     */
    @Delete("{communityId}/bookmark")
    @Security("bearerAuth")
    @Middlewares(authorizeUser())
    @Response(401, "UNAUTHORIZED")
    @Response(404, "NOT_BOOKMARKED")
    public async unbookmark(
        @Request() req: ExpressRequest,
        @Path() communityId: string
    ): Promise<ApiResponse<BookmarkResponseDto>> {
        const result = await communityService.removeBookmark(req.user!.id, communityId);
        return success(result, "저장이 해제되었습니다.");
    }
}
