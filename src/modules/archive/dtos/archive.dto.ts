import { z } from "zod";
import { MissionDifficultyLabel } from "../../mission/dtos/mission.constants";

export type ArchiveItemType = "conversation" | "phrase" | "report" | "mission";

// GET /archives/summary
export interface RecentArchiveItemDto {
    /**
     * 미션 항목은 missionId, 그 외 항목은 archive item ID
     * @example "550e8400-e29b-41d4-a716-446655440000"
     */
    id: string;
    type: ArchiveItemType;
    title: string;
    isBookmarked: boolean;
    /** type이 mission일 때 미션 상세 조회에 사용하는 ID */
    missionId: string | null;
    /** 진행 중인 미션의 대화를 이어갈 때 사용하는 ID */
    conversationId: string | null;
    /** 완료된 미션 수행 기록 ID */
    missionRecordId: string | null;
    missionStatus?: "in_progress" | "completed";
    category?: string;
    difficulty?: MissionDifficultyLabel;
    estimatedMinutes?: number;
    rewardXp?: number;
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
    sort?: "latest" | "oldest" | "saved";
    folderId?: string;
    tag?: string;
}

export const searchArchivesQuerySchema = z.object({
    keyword: z.string().optional(),
    type: z.enum(["conversation", "phrase", "report", "mission"]).optional(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    sort: z.enum(["latest", "oldest", "saved"]).optional(),
    folderId: z.string().optional(),
    tag: z.string().optional(),
}) satisfies z.ZodType<SearchArchivesQueryDto>;

export interface ArchiveSearchItemDto {
    id: string;
    type: ArchiveItemType;
    title: string;
    tags: string[];
    folderId: string | null;
    isBookmarked: boolean;
    missionStatus?: "in_progress" | "completed" | null;
    category?: string;
    difficulty?: MissionDifficultyLabel;
    estimatedMinutes?: number;
    rewardXp?: number;
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
