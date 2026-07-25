import { Prisma } from "@prisma/client";
import { prisma } from "../../../config/database";

export const countConversations = (userId: string) =>
    prisma.archive_Items.count({ where: { user_id: userId, item_type: "conversation" } });

export const countSavedPhrases = (userId: string) =>
    prisma.archive_Items.count({ where: { user_id: userId, item_type: "phrase" } });

export const countReports = (userId: string) =>
    prisma.archive_Items.count({ where: { user_id: userId, item_type: "report" } });

export const findRecentArchiveItems = (userId: string, take: number) =>
    prisma.archive_Items.findMany({
        where: {
            user_id: userId,
            item_type: { in: ["conversation", "phrase", "report"] },
        },
        orderBy: { created_at: "desc" },
        take,
    });

// 최근 활동용: 미션은 상태 무관(완료+진행중) 최신 N건
export const findRecentMissionRecords = (userId: string, take: number) =>
    prisma.mission_Records.findMany({
        where: {
            user_id: userId,
            status: "completed",
        },
        include: {
            mission: {
                select: {
                    id: true,
                    title: true,
                    category: true,
                    difficulty: true,
                    estimated_minutes: true,
                    reward_xp: true,
                },
            },
        },
        orderBy: [
            { completed_at: "desc" },
            { created_at: "desc" },
        ],
        distinct: ["mission_id"],
        take,
    });

// 미션 시작 활동은 Mission_Records가 아니라 Conversations에 먼저 기록됨
// 진행 중인 대화 중 미션별 최신 한 건만 조회해 summary 최근 활동에 합친다.
export const findRecentStartedMissions = (userId: string, take: number) =>
    prisma.conversations.findMany({
        where: {
            user_id: userId,
            status: "in_progress",
        },
        include: {
            mission: {
                select: {
                    id: true,
                    title: true,
                    category: true,
                    difficulty: true,
                    estimated_minutes: true,
                    reward_xp: true,
                },
            },
        },
        orderBy: { started_at: "desc" },
        distinct: ["mission_id"],
        take,
    });

// 검색/필터 (conversation/phrase/report 전용 - mission은 searchMissionRecords로 분리)
export const searchArchiveItems = (params: {
    userId: string;
    type?: "conversation" | "phrase" | "report";
    startDate?: Date;
    endDate?: Date;
    sort: "asc" | "desc";
    folderId?: string;
    tags?: string[];
}) =>
    prisma.archive_Items.findMany({
        where: {
            user_id: params.userId,
            item_type: params.type
                ? params.type
                : { in: ["conversation", "phrase", "report"] },
            ...(params.folderId && { folder_id: params.folderId }),
            ...(params.startDate || params.endDate
                ? {
                    created_at: {
                        ...(params.startDate && { gte: params.startDate }),
                        ...(params.endDate && { lte: params.endDate }),
                    },
                }
                : {}),
            // 태그 필터: tags가 string[] 형태인 것을 전제로 함
            // - 정확히 일치하는 태그만 매칭 (부분 검색 X)
            // - array_contains에는 반드시 배열로 감싸서 전달 ([tag], not tag)
            // - tags 구조가 객체 배열({name: string}[])로 바뀌면 이 부분 검토 필요
            ...(params.tags?.length
                ? {
                    AND: params.tags.map((tag) => ({
                        tags: { array_contains: [tag] },
                    })),
                }
                : {}),
        },
        orderBy: { created_at: params.sort },
    });

export const countArchiveItems = (params: {
    userId: string;
    type?: "conversation" | "phrase" | "report";
    startDate?: Date;
    endDate?: Date;
    folderId?: string;
}) =>
    prisma.archive_Items.count({
        where: {
            user_id: params.userId,
            item_type: params.type
                ? params.type
                : { in: ["conversation", "phrase", "report"] },
            ...(params.folderId && { folder_id: params.folderId }),
            ...(params.startDate || params.endDate
                ? {
                    created_at: {
                        ...(params.startDate && { gte: params.startDate }),
                        ...(params.endDate && { lte: params.endDate }),
                    },
                }
                : {}),
        },
    });

// Archive_Items 참조 대상 title 조회
// reference_id는 FK가 아니라 item_type에 따라 다른 테이블을 가리키는 참조
export const findConversationTitle = (conversationId: string) =>
    prisma.conversations.findUnique({
        where: { id: conversationId },
        select: { mission: { select: { title: true } } },
    });

export const findSavedPhraseContent = (phraseId: string) =>
    prisma.saved_Phrases.findUnique({
        where: { id: phraseId },
        select: { content: true },
    });

export const findReportMeta = (reportId: string) =>
    prisma.reports.findUnique({
        where: { id: reportId },
        select: { type: true, period: true },
    });

// Saved Phrases
export const findPhraseById = (phraseId: string, userId: string) =>
    prisma.saved_Phrases.findFirst({
        where: { id: phraseId, user_id: userId },
        include: {
            conversation: { include: { mission: { select: { title: true } } } },
        },
    });

export const createSavedPhrase = (data: Prisma.Saved_PhrasesCreateInput) =>
    prisma.saved_Phrases.create({ data });

export const deleteSavedPhrase = (phraseId: string) =>
    prisma.saved_Phrases.delete({ where: { id: phraseId } });

export const deleteSavedPhraseWithArchiveItem = (itemId: string, phraseId: string) =>
    prisma.$transaction([
        prisma.archive_Items.delete({ where: { id: itemId } }),
        prisma.saved_Phrases.delete({ where: { id: phraseId } }),
    ]);

// Conversations
export const findConversationDetail = (conversationId: string, userId: string) =>
    prisma.conversations.findFirst({
        where: { id: conversationId, user_id: userId },
        include: {
            mission: { select: { title: true } },
            messages: { orderBy: { created_at: "asc" } },
            // Feedbacks.conversation_id에 unique 제약이 없어 1:N 관계
            // 서비스 레이어에서는 feedbacks[0]로 첫 건만 사용 중 - 여러 건일 때 확인 필요
            feedbacks: true,
        },
    });

// Conversations 존재 여부 확인용
export const findConversationById = (conversationId: string, userId: string) =>
    prisma.conversations.findFirst({ where: { id: conversationId, user_id: userId } });

// Archive Items (conversation/phrase/report 전용)
export const createArchiveItem = (
    data: Prisma.Archive_ItemsCreateInput,
    tx?: Prisma.TransactionClient
) => (tx ?? prisma).archive_Items.create({ data });

export const findArchiveItemById = (itemId: string, userId: string) =>
    prisma.archive_Items.findFirst({ where: { id: itemId, user_id: userId } });

// 특정 원본 리소스(conversation/phrase/report)를 가리키는 Archive_Items row 조회
// 예: phrase 상세에서 folderId를 알아내려면 이 함수로 매핑 row를 찾아야 함
// mission은 Archive_Items를 쓰지 않으므로 itemType에서 제외
export const findArchiveItemByReference = (
    userId: string,
    itemType: "conversation" | "phrase" | "report",
    referenceId: string
) =>
    prisma.archive_Items.findFirst({
        where: { user_id: userId, item_type: itemType, reference_id: referenceId },
    });

export const deleteArchiveItem = (itemId: string, tx?: Prisma.TransactionClient) =>
    (tx ?? prisma).archive_Items.delete({ where: { id: itemId } });

export const updateArchiveItemFolder = (itemId: string, folderId: string) =>
    prisma.archive_Items.update({ where: { id: itemId }, data: { folder_id: folderId } });

// Folders
export const findFoldersByUser = (userId: string) =>
    prisma.archive_Folders.findMany({ where: { user_id: userId } });

export const countItemsByFolder = (folderId: string) =>
    prisma.archive_Items.count({ where: { folder_id: folderId } });

export const findFolderByName = (userId: string, name: string) =>
    prisma.archive_Folders.findFirst({ where: { user_id: userId, name } });

export const createFolder = (data: Prisma.Archive_FoldersCreateInput) =>
    prisma.archive_Folders.create({ data });

export const findFolderById = (folderId: string, userId: string) =>
    prisma.archive_Folders.findFirst({ where: { id: folderId, user_id: userId } });

export const updateFolderName = (folderId: string, name: string) =>
    prisma.archive_Folders.update({ where: { id: folderId }, data: { name } });
