import { z } from "zod";

export type ArchiveItemType = "conversation" | "phrase" | "report";

// GET /archives/summary
export interface RecentArchiveItemDto {
    id: string;
    type: ArchiveItemType;
    title: string;
    createdAt: string;
}

export interface ArchiveSummaryResponseDto {
    totalCount: number;
    missionRecordCount: number;
    conversationCount: number;
    phraseCount: number;
    reportCount: number;
    recentItems: RecentArchiveItemDto[];
}

// GET /archives
export interface SearchArchivesQueryDto {
    keyword?: string;
    type?: ArchiveItemType;
    startDate?: string;
    endDate?: string;
    sort?: "latest" | "oldest";
    folderId?: string;
    tag?: string;
}

export const searchArchivesQuerySchema = z.object({
    keyword: z.string().optional(),
    type: z.enum(["conversation", "phrase", "report"]).optional(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    sort: z.enum(["latest", "oldest"]).optional(),
    folderId: z.string().optional(),
    tag: z.string().optional(),
}) satisfies z.ZodType<SearchArchivesQueryDto>;

export interface ArchiveSearchItemDto {
    id: string;
    type: ArchiveItemType;
    title: string;
    tags: string[];
    folderId: string | null;
    createdAt: string;
}

export interface SearchArchivesResponseDto {
    totalCount: number;
    items: ArchiveSearchItemDto[];
}

// GET /archives/conversations/{conversationId}
export interface ConversationDetailMessageDto {
    sender: "USER" | "AI";
    content: string;
    sentAt: string;
}

export interface ConversationFeedbackDto {
    feedbackId: string;
    kindnessScore: number;
    initiativeScore: number;
    empathyScore: number;
    questionLinkScore: number;
}

export interface ConversationDetailResponseDto {
    conversationId: string;
    missionTitle: string | null;
    summary: string;
    messages: ConversationDetailMessageDto[];
    feedback: ConversationFeedbackDto | null;
}

// GET /archives/phrases/{phraseId}
export interface PhraseDetailResponseDto {
    id: string;
    content: string;
    memo: string | null;
    missionTitle: string | null;
    conversationId: string | null;
    folderId: string | null;
    createdAt: string;
}

// POST /archives/phrases
export interface CreatePhraseRequestDto {
    conversationId: string;
    content: string;
    memo?: string;
}

export const createPhraseRequestSchema = z.object({
    conversationId: z.string().uuid(),
    content: z.string().trim().min(1, "저장할 문장을 입력해주세요."),
    memo: z.string().optional(),
}) satisfies z.ZodType<CreatePhraseRequestDto>;

export interface CreatePhraseResponseDto {
    id: string;
    conversationId: string;
    content: string;
    memo: string | null;
    createdAt: string;
}

// DELETE /archives/items/{itemId} 
export interface DeleteArchiveItemResponseDto {
    itemId: string;
    deleted: true;
}

// GET /archives/folders
export interface ArchiveFolderDto {
    id: string;
    name: string;
    itemCount: number;
}

export interface ListFoldersResponseDto {
    folders: ArchiveFolderDto[];
}

// POST /archives/folders
export interface CreateFolderRequestDto {
    name: string;
}

export const createFolderRequestSchema = z.object({
    name: z.string().trim().min(1, "폴더명을 입력해주세요."),
}) satisfies z.ZodType<CreateFolderRequestDto>;

export interface CreateFolderResponseDto {
    id: string;
    name: string;
}

// PATCH /archives/folders/{folderId}
export interface UpdateFolderRequestDto {
    name: string;
}

export const updateFolderRequestSchema = z.object({
    name: z.string().trim().min(1, "폴더명을 입력해주세요."),
}) satisfies z.ZodType<UpdateFolderRequestDto>;

export interface UpdateFolderResponseDto {
    id: string;
    name: string;
}

// POST /archives/folders/{folderId}/items
export interface AddItemToFolderRequestDto {
    itemId: string;
}

export const addItemToFolderRequestSchema = z.object({
    itemId: z.string().uuid(),
}) satisfies z.ZodType<AddItemToFolderRequestDto>;

export interface AddItemToFolderResponseDto {
    folderId: string;
    itemId: string;
}