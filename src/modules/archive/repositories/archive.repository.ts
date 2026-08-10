import { ArchiveItemType, Prisma } from "@prisma/client";
import { prisma } from "../../../config/database";

export const countConversations = (userId: string) =>
    prisma.archive_Items.count({ where: { user_id: userId, item_type: "conversation" } });

export const countSavedPhrases = (userId: string) =>
    prisma.archive_Items.count({ where: { user_id: userId, item_type: "phrase" } });

// 아카이브의 "리포트" 항목에는 성장 리포트(report)와 저장된 주간 비교 리포트(weekly_compare)가
// 함께 묶인다 — 미션이 완료/진행중으로 나뉘어 하나의 type=mission으로 묶이는 것과 같은 방식이다.
const REPORT_ITEM_TYPES = ["report", "weekly_compare"] as const;

export const countReports = (userId: string) =>
    prisma.archive_Items.count({ where: { user_id: userId, item_type: { in: [...REPORT_ITEM_TYPES] } } });

export const findRecentArchiveItems = (userId: string, take: number) =>
    prisma.archive_Items.findMany({
        where: {
            user_id: userId,
            item_type: { in: ["conversation", "phrase", ...REPORT_ITEM_TYPES] },
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
// type="report"로 조회하면 성장 리포트와 저장된 주간 비교 리포트를 함께 반환한다.
const itemTypesForSearch = (type?: "conversation" | "phrase" | "report"): ArchiveItemType[] =>
    type === "report"
        ? [...REPORT_ITEM_TYPES]
        : type
            ? [type]
            : ["conversation", "phrase", ...REPORT_ITEM_TYPES];

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
            item_type: { in: itemTypesForSearch(params.type) },
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
            item_type: { in: itemTypesForSearch(params.type) },
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

// #155/#169 — 아카이브의 대화 카드에 AI 요약(칩/설명)을 함께 보여주기 위한 일괄 조회.
// 결과 목록의 대화 개수만큼 개별 조회(N+1)하지 않도록, conversationId 목록을 한 번에 받아
// Feedbacks를 IN 절 하나로 조회한다. 피드백이 없는(status: pending) 대화는 결과에서 빠진다 —
// 호출부에서 Map.get()이 undefined면 null/빈 배열로 처리한다.
// card_summary는 카드용 축약 요약(1~2줄) — 상세용 conversation_summary와 별개 컬럼(#169).
export const findConversationSummaryInfoByIds = (conversationIds: string[]) =>
    prisma.feedbacks.findMany({
        // 재시도(retryFeedback)는 status만 pending으로 되돌리고 이전 conversation_summary/
        // summary_chips는 지우지 않는다. status: "ready"로 걸지 않으면 재생성 중인 대화에서
        // 낡은 요약이 그대로 노출된다.
        where: { conversation_id: { in: conversationIds }, status: "ready" },
        select: { conversation_id: true, card_summary: true, summary_chips: true },
    });

// #175 — 대화 카드의 소요 시간(started_at/finished_at)을 계산하기 위한 일괄 조회.
// findConversationSummaryInfoByIds(Feedbacks 기반)와 별개인 이유: 소요 시간은 피드백 생성 여부와
// 무관하게(status: "ready"가 아니어도) 항상 계산 가능해야 하므로, Conversations를 직접 IN 조회한다.
export const findConversationDurationInfoByIds = (conversationIds: string[]) =>
    prisma.conversations.findMany({
        where: { id: { in: conversationIds } },
        select: { id: true, started_at: true, finished_at: true },
    });

export const findSavedPhraseContent = (phraseId: string) =>
    prisma.saved_Phrases.findUnique({
        where: { id: phraseId },
        select: { content: true },
    });

export const findReportData = (reportId: string) =>
    prisma.reports.findUnique({
        where: { id: reportId },
        select: { data: true },
    });

export const findWeeklyCompareReportWeekIndex = (weeklyCompareReportId: string) =>
    prisma.weekly_Compare_Reports.findUnique({
        where: { id: weeklyCompareReportId },
        select: { week_index: true },
    });

// Saved Phrases
export const findPhraseById = (phraseId: string, userId: string) =>
    prisma.saved_Phrases.findFirst({
        where: { id: phraseId, user_id: userId },
        include: {
            conversation: {
                include: {
                    mission: { select: { title: true } },
                    // 메모 칩은 대화 요약 칩(Feedbacks.summary_chips)을 재사용한다 (이슈 #83).
                    feedbacks: { select: { summary_chips: true } },
                },
            },
        },
    });

export const createSavedPhrase = (
    data: Prisma.Saved_PhrasesCreateInput
) => prisma.saved_Phrases.create({ data });

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
    prisma.conversations.findFirst({
        where: { id: conversationId, user_id: userId },
        include: { mission: true },
    });

// 문장 평가 AI 프롬프트용 — 해당 대화의 최근 메시지를 시간순으로 가져온다.
// system 메시지는 실제 대화 교환이 아니므로 제외한다.
// 전체 대화가 아니라 최근 일부만 쓰는 이유: 프롬프트 길이 제한 + 저장 시점 근처 맥락이 평가에 더 유의미.
const PHRASE_EVALUATION_CONTEXT_LIMIT = 10;

export const findRecentConversationMessages = (conversationId: string) =>
    prisma.conversation_Messages
        .findMany({
            where: {
                conversation_id: conversationId,
                role: { in: ["user", "guide"] },
            },
            orderBy: { created_at: "desc" },
            take: PHRASE_EVALUATION_CONTEXT_LIMIT,
            select: { role: true, content: true },
        })
        .then((rows) => rows.reverse()); // 시간순(오래된 → 최신)으로 뒤집는다

// Archive Items (conversation/phrase/report 전용)
export const createArchiveItem = (
    data: Prisma.Archive_ItemsCreateInput,
    tx?: Prisma.TransactionClient
) => (tx ?? prisma).archive_Items.create({ data });

export const findArchiveItemById = (itemId: string, userId: string) =>
    prisma.archive_Items.findFirst({ where: { id: itemId, user_id: userId } });

// 특정 원본 리소스(conversation/phrase/report/weekly_compare)를 가리키는 Archive_Items row 조회
// 예: phrase 상세에서 folderId를 알아내려면 이 함수로 매핑 row를 찾아야 함
// mission은 Archive_Items를 쓰지 않으므로 itemType에서 제외
export const findArchiveItemByReference = (
    userId: string,
    itemType: "conversation" | "phrase" | "report" | "weekly_compare",
    referenceId: string
) =>
    prisma.archive_Items.findFirst({
        where: { user_id: userId, item_type: itemType, reference_id: referenceId },
    });

// 특정 타입의 저장된 reference_id 전체. 목록 화면에서 항목마다 "저장됨" 여부를 표시할 때,
// 항목 수만큼 개별 조회하는 대신 한 번에 가져와 Set으로 대조한다.
export const findArchivedReferenceIds = async (
    userId: string,
    itemType: "conversation" | "phrase" | "report" | "weekly_compare"
): Promise<Set<string>> => {
    const rows = await prisma.archive_Items.findMany({
        where: { user_id: userId, item_type: itemType },
        select: { reference_id: true },
    });
    return new Set(rows.map((r) => r.reference_id));
};

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
