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
    /** ID of the resource used by its detail API (conversation/phrase/report/mission). */
    referenceId: string;
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
    /** type이 report일 때 성장 리포트/저장된 주간 비교 리포트를 구분한다. */
    reportType?: "growth" | "weekly_compare";
    /** type이 conversation일 때만 존재. AI가 생성한 대화 요약 칩 중 앞 2개(#154). */
    tags?: string[];
    /** type이 conversation일 때만 존재. AI가 생성한 대화 요약 2~3문장. 피드백 생성 전이면 null(#154). */
    description?: string | null;
    category?: string;
    difficulty?: MissionDifficultyLabel;
    estimatedMinutes?: number;
    rewardXp?: number;
    /** type이 conversation일 때만 존재. 대화 소요 시간 "mm:ss". 아직 종료되지 않았으면 null(#175). */
    duration?: string | null;
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
    /** type=mission 전용. 북마크한 미션을 완료 여부로 좁힌다 (#86). */
    missionFilter?: "all" | "completed" | "incomplete";
    folderId?: string;
    tag?: string;
    page?: number;
    size?: number;
}

export const searchArchivesQuerySchema = z.object({
    keyword: z.string().optional(),
    type: z.enum(["conversation", "phrase", "report", "mission"]).optional(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    sort: z.enum(["latest", "oldest"]).optional(),
    missionFilter: z.enum(["all", "completed", "incomplete"]).optional(),
    folderId: z.string().optional(),
    tag: z.string().optional(),
    page: z.coerce.number().int().positive().optional(),
    size: z.coerce.number().int().positive().max(100).optional(),
}) satisfies z.ZodType<SearchArchivesQueryDto>;

export interface ArchiveSearchItemDto {
    /** Archive_Items.id. Missions are not stored in Archive_Items, so this is null for missions. */
    archiveItemId: string | null;
    /** ID of the resource used by its detail API (conversation/phrase/report/mission). */
    referenceId: string;
    id: string;
    type: ArchiveItemType;
    title: string;
    tags: string[];
    folderId: string | null;
    isBookmarked: boolean;
    missionStatus?: "in_progress" | "completed" | null;
    /** type이 report일 때 성장 리포트/저장된 주간 비교 리포트를 구분한다. */
    reportType?: "growth" | "weekly_compare";
    /** type이 conversation일 때만 존재. AI가 생성한 대화 요약 2~3문장. 피드백 생성 전이면 null(#154). */
    description?: string | null;
    category?: string;
    difficulty?: MissionDifficultyLabel;
    estimatedMinutes?: number;
    rewardXp?: number;
    /** type이 conversation일 때만 존재. 대화 소요 시간 "mm:ss". 아직 종료되지 않았으면 null(#175). */
    duration?: string | null;
    /** Missions.id; populated only for mission cards. */
    missionId: string | null;
    /** Mission_Records.id; execution-history metadata, never a mission detail ID. */
    missionRecordId: string | null;
    createdAt: string;
}

export interface SearchArchivesResponseDto {
    totalCount: number;
    items: ArchiveSearchItemDto[];
    pageInfo: {
        currentPage: number;
        totalPages: number;
        totalCount: number;
    };
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
    /** 대화 전체를 2~3문장으로 요약한 텍스트. 피드백 생성 전에는 빈 문자열. */
    summary: string;
    /** 대화 소요 시간 "mm:ss". 아직 종료되지 않았으면 null(#175 — 기존엔 분 단위 숫자였음). */
    duration: string | null;
    /** 대화 요약 키워드 칩 3개(단어 형태). 피드백 생성 전에는 빈 배열. */
    summaryChips: string[];
    /** "주요 내용" — 실제 대화 흐름을 2~3개 포인트로 서술. 피드백 생성 전에는 빈 배열(#169). */
    keyPoints: string[];
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
    /**
     * 메모 키워드 칩 3개. 현재는 대화 요약 칩(Feedbacks.summary_chips)을 재사용한다.
     * (Figma상 대화 요약 칩과 메모 칩이 구분되지 않아 추후 확정 필요 — 이슈 #83)
     */
    summaryChips: string[];
    /** 저장된 문장이 속한 대화의 소요 시간 "mm:ss". 대화가 아직 종료되지 않았으면 null(#175). */
    duration: string | null;
    createdAt: string;
}

// POST /archives/phrases
export interface CreatePhraseRequestDto {
    conversationId: string;
    content: string;
    // memo 제거 — AI가 자동 생성으로 변경
}

export const createPhraseRequestSchema = z.object({
    conversationId: z.string().uuid(),
    content: z.string().trim().min(1, "저장할 문장을 입력해주세요."),
}) satisfies z.ZodType<CreatePhraseRequestDto>;

export interface CreatePhraseResponseDto {
    id: string;
    conversationId: string;
    content: string;
    memo: string | null;
    /** AI가 생성한 태그 3개 고정. AI 실패 시 빈 배열. */
    chips: string[];
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
