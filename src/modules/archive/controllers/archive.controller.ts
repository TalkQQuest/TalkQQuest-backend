import { Body, Controller, Delete, Get, Query, Middlewares, Patch, Path, Post, Request, Route, Security, Tags } from "tsoa";
import type { Request as ExpressRequest } from "express";
import { authorizeUser } from "../../../middlewares/auth";
import { validate } from "../../../middlewares/validator";
import { ValidationError } from "../../../shared/errors/common.error";
import { success, ApiResponse } from "../../../shared/utils/response";
import {
    ArchiveSummaryResponseDto,
    searchArchivesQuerySchema,
    SearchArchivesResponseDto,
    ConversationDetailResponseDto,
    PhraseDetailResponseDto,
    createPhraseRequestSchema,
    CreatePhraseRequestDto,
    CreatePhraseResponseDto,
    DeleteArchiveItemResponseDto,
    ListFoldersResponseDto,
    createFolderRequestSchema,
    CreateFolderRequestDto,
    CreateFolderResponseDto,
    updateFolderRequestSchema,
    UpdateFolderRequestDto,
    UpdateFolderResponseDto,
    addItemToFolderRequestSchema,
    AddItemToFolderRequestDto,
    AddItemToFolderResponseDto,
} from "../dtos/archive.dto";
import * as archiveService from "../services/archive.service";

@Route("archives")
@Tags("Archive")
export class ArchiveController extends Controller {
    /**
     * @summary 아카이브 카운트/최근 활동 조회
     */
    @Get("summary")
    @Security("bearerAuth")
    @Middlewares(authorizeUser())
    public async getSummary(@Request() req: ExpressRequest): Promise<ApiResponse<ArchiveSummaryResponseDto>> {
        const result = await archiveService.getArchiveSummary(req.user!.id);
        return success(result);
    }

    /**
 * @summary 아카이브 검색 및 필터
 */
@Get()
@Security("bearerAuth")
@Middlewares(authorizeUser())
public async search(
    @Request() req: ExpressRequest,
    @Query() keyword?: string,
    @Query() type?: "conversation" | "phrase" | "report" | "mission",
    @Query() startDate?: string,
    @Query() endDate?: string,
    @Query() sort?: "latest" | "oldest" | "saved",
    @Query() folderId?: string,
    @Query() tag?: string,
    @Query() page?: number,
    @Query() size?: number
): Promise<ApiResponse<SearchArchivesResponseDto>> {
    const parsed = searchArchivesQuerySchema.safeParse({
        keyword,
        type,
        startDate,
        endDate,
        sort,
        folderId,
        tag,
        page,
        size,
    });
    if (!parsed.success) {
        throw new ValidationError("잘못된 검색 조건입니다.", parsed.error.issues);
    }
    const result = await archiveService.searchArchives(req.user!.id, parsed.data);
    return success(result);
}

    /**
     * @summary 대화 기록 상세 조회
     */
    @Get("conversations/{conversationId}")
    @Security("bearerAuth")
    @Middlewares(authorizeUser())
    public async getConversationDetail(
        @Request() req: ExpressRequest,
        @Path() conversationId: string
    ): Promise<ApiResponse<ConversationDetailResponseDto>> {
        const result = await archiveService.getConversationDetail(req.user!.id, conversationId);
        return success(result);
    }

    /**
     * @summary 저장 문장 상세 조회
     */
    @Get("phrases/{phraseId}")
    @Security("bearerAuth")
    @Middlewares(authorizeUser())
    public async getPhraseDetail(
        @Request() req: ExpressRequest,
        @Path() phraseId: string
    ): Promise<ApiResponse<PhraseDetailResponseDto>> {
        const result = await archiveService.getPhraseDetail(req.user!.id, phraseId);
        return success(result);
    }

    /**
     * @summary 문장 저장
     */
    @Post("phrases")
    @Security("bearerAuth")
    @Middlewares(authorizeUser(), validate(createPhraseRequestSchema))
    public async createPhrase(
        @Request() req: ExpressRequest,
        @Body() body: CreatePhraseRequestDto
    ): Promise<ApiResponse<CreatePhraseResponseDto>> {
        const result = await archiveService.createPhrase(req.user!.id, body);
        return success(result, "문장이 저장되었습니다.");
    }

    /** @summary 저장 문장 해제 */
    @Delete("phrases/{phraseId}")
    @Security("bearerAuth")
    @Middlewares(authorizeUser())
    public async deletePhrase(
        @Request() req: ExpressRequest,
        @Path() phraseId: string
    ): Promise<ApiResponse<DeleteArchiveItemResponseDto>> {
        const result = await archiveService.deletePhrase(req.user!.id, phraseId);
        return success(result, "저장 문장이 해제되었습니다.");
    }

    /**
     * @summary 아카이브 항목 삭제
     */
    @Delete("items/{itemId}")
    @Security("bearerAuth")
    @Middlewares(authorizeUser())
    public async deleteItem(
        @Request() req: ExpressRequest,
        @Path() itemId: string
    ): Promise<ApiResponse<DeleteArchiveItemResponseDto>> {
        const result = await archiveService.deleteArchiveItem(req.user!.id, itemId);
        return success(result, "삭제되었습니다.");
    }

    /**
     * @summary 폴더 목록 조회
     */
    @Get("folders")
    @Security("bearerAuth")
    @Middlewares(authorizeUser())
    public async listFolders(@Request() req: ExpressRequest): Promise<ApiResponse<ListFoldersResponseDto>> {
        const result = await archiveService.listFolders(req.user!.id);
        return success(result);
    }

    /**
     * @summary 새 폴더 생성
     */
    @Post("folders")
    @Security("bearerAuth")
    @Middlewares(authorizeUser(), validate(createFolderRequestSchema))
    public async createFolder(
        @Request() req: ExpressRequest,
        @Body() body: CreateFolderRequestDto
    ): Promise<ApiResponse<CreateFolderResponseDto>> {
        const result = await archiveService.createFolder(req.user!.id, body);
        return success(result, "폴더가 생성되었습니다.");
    }

    /**
     * @summary 폴더명 수정
     */
    @Patch("folders/{folderId}")
    @Security("bearerAuth")
    @Middlewares(authorizeUser(), validate(updateFolderRequestSchema))
    public async updateFolder(
        @Request() req: ExpressRequest,
        @Path() folderId: string,
        @Body() body: UpdateFolderRequestDto
    ): Promise<ApiResponse<UpdateFolderResponseDto>> {
        const result = await archiveService.updateFolder(req.user!.id, folderId, body);
        return success(result, "폴더명이 수정되었습니다.");
    }

    /**
     * @summary 항목 폴더 저장
     */
    @Post("folders/{folderId}/items")
    @Security("bearerAuth")
    @Middlewares(authorizeUser(), validate(addItemToFolderRequestSchema))
    public async addItemToFolder(
        @Request() req: ExpressRequest,
        @Path() folderId: string,
        @Body() body: AddItemToFolderRequestDto
    ): Promise<ApiResponse<AddItemToFolderResponseDto>> {
        const result = await archiveService.addItemToFolder(req.user!.id, folderId, body);
        return success(result, "폴더로 이동되었습니다.");
    }
}
