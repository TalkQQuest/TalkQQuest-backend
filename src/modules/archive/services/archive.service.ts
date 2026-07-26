import { NotFoundError } from "../../../shared/errors/common.error";
import * as archiveRepository from "../repositories/archive.repository";
import * as missionRepository from "../../mission/repositories/mission.repository";
import {
    ItemNotFoundError,
    PhraseNotFoundError,
    FolderNotFoundError,
    ArchiveConversationNotFoundError,
} from "../errors/archive.error";
import {
    ArchiveSummaryResponseDto,
    SearchArchivesQueryDto,
    SearchArchivesResponseDto,
    ArchiveSearchItemDto,
    ConversationDetailResponseDto,
    PhraseDetailResponseDto,
    CreatePhraseRequestDto,
    CreatePhraseResponseDto,
    DeleteArchiveItemResponseDto,
    ListFoldersResponseDto,
    CreateFolderRequestDto,
    CreateFolderResponseDto,
    UpdateFolderRequestDto,
    UpdateFolderResponseDto,
    AddItemToFolderRequestDto,
    AddItemToFolderResponseDto,
    ArchiveItemType,
} from "../dtos/archive.dto";
import { DuplicatedError } from "../../../shared/errors/common.error";
import { DIFFICULTY_TO_LABEL } from "../../mission/dtos/mission.constants";
import { durationMinutes } from "../../../shared/utils/date";

// Feedbacks.summary_chips(Json)를 안전하게 string[]로 변환한다. 없거나 형식이 다르면 빈 배열.
const toSummaryChips = (raw: unknown): string[] =>
    Array.isArray(raw) ? raw.filter((c): c is string => typeof c === "string") : [];

const RECENT_ITEMS_LIMIT = 10;
const DEFAULT_PAGE = 1;
const DEFAULT_SIZE = 20;

const paginate = (
    items: ArchiveSearchItemDto[],
    page: number,
    size: number
): SearchArchivesResponseDto => {
    const totalCount = items.length;
    return {
        totalCount,
        items: items.slice((page - 1) * size, page * size),
        pageInfo: {
            currentPage: page,
            totalPages: Math.max(1, Math.ceil(totalCount / size)),
            totalCount,
        },
    };
};

const resolveItemTitle = async (
    itemType: "conversation" | "phrase" | "report",
    referenceId: string
): Promise<string> => {
    switch (itemType) {
        case "conversation": {
            const conversation = await archiveRepository.findConversationTitle(referenceId);
            return conversation?.mission?.title ?? "제목 없음";
        }
        case "phrase": {
            const phrase = await archiveRepository.findSavedPhraseContent(referenceId);
            if (!phrase) return "제목 없음";
            return phrase.content.length > 40 ? `${phrase.content.slice(0, 40)}...` : phrase.content;
        }
        case "report": {
            const report = await archiveRepository.findReportData(referenceId);
            if (!report) return "제목 없음";
            const data = report.data as { title?: unknown } | null;
            return typeof data?.title === "string" ? data.title : "제목 없음";
        }
    }
};

export const getArchiveSummary = async (userId: string): Promise<ArchiveSummaryResponseDto> => {
    const [
        missionRecordCount,
        conversationCount,
        phraseCount,
        reportCount,
        recentArchiveRows,
        recentMissionRows,
        recentStartedMissionRows,
    ] =
        await Promise.all([
            // #86: 미션 탭이 북마크 기준으로 바뀌면서, 이 카운트도 "완료 기록 수"가 아니라
            // "북마크한 미션 수"로 의미가 바뀐다 (필드명 missionRecordCount는 유지, 의미만 변경).
            missionRepository.countSavedMissions(userId),
            archiveRepository.countConversations(userId),
            archiveRepository.countSavedPhrases(userId),
            archiveRepository.countReports(userId),
            archiveRepository.findRecentArchiveItems(userId, RECENT_ITEMS_LIMIT),
            archiveRepository.findRecentMissionRecords(userId, RECENT_ITEMS_LIMIT),
            archiveRepository.findRecentStartedMissions(userId, RECENT_ITEMS_LIMIT),
        ]);

    // 최근 완료/시작 활동에 포함된 미션의 저장 여부를 별도로 조회한다.
    const missionIds = [...recentMissionRows, ...recentStartedMissionRows]
        .map((row) => row.mission?.id)
        .filter((id): id is string => !!id);
    const savedRows = missionIds.length
        ? await missionRepository.findSavedMissionIds(userId, [...new Set(missionIds)])
        : [];
    const savedMissionIds = new Set(savedRows.map((s) => s.mission_id));

    const archiveItemsResolved = await Promise.all(
        recentArchiveRows.map(async (row) => ({
            id: row.id,
            type: row.item_type as ArchiveItemType,
            title: await resolveItemTitle(row.item_type as "conversation" | "phrase" | "report", row.reference_id),
            isBookmarked: true,
            missionId: null,
            conversationId: null,
            missionRecordId: null,
            createdAt: row.created_at.toISOString(),
        }))
    );

    const completedMissionItems = recentMissionRows.map((row) => ({
        id: row.mission_id,
        missionId: row.mission_id,
        conversationId: null,
        missionRecordId: row.id,
        type: "mission" as ArchiveItemType,
        title: row.mission?.title ?? "제목 없음",
        isBookmarked: row.mission ? savedMissionIds.has(row.mission.id) : false,
        missionStatus: "completed" as const,
        category: row.mission?.category,
        difficulty: row.mission ? DIFFICULTY_TO_LABEL[row.mission.difficulty] : undefined,
        estimatedMinutes: row.mission?.estimated_minutes,
        rewardXp: row.mission?.reward_xp,
        createdAt: (row.completed_at ?? row.created_at).toISOString(),
    }));

    const startedMissionItems = recentStartedMissionRows.map((row) => ({
        id: row.mission_id,
        missionId: row.mission_id,
        conversationId: row.id,
        missionRecordId: null,
        type: "mission" as ArchiveItemType,
        title: row.mission.title,
        isBookmarked: savedMissionIds.has(row.mission.id),
        missionStatus: "in_progress" as const,
        category: row.mission.category,
        difficulty: DIFFICULTY_TO_LABEL[row.mission.difficulty],
        estimatedMinutes: row.mission.estimated_minutes,
        rewardXp: row.mission.reward_xp,
        createdAt: row.started_at.toISOString(),
    }));

    // 동일 미션의 시작/완료 활동 중 가장 최근 한 건만 유지한다.
    const seenMissionIds = new Set<string>();
    const latestMissionItems = [...completedMissionItems, ...startedMissionItems]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .filter((item) => {
            if (seenMissionIds.has(item.missionId)) return false;
            seenMissionIds.add(item.missionId);
            return true;
        });

    const recentItems = [...archiveItemsResolved, ...latestMissionItems]
        .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1))
        .slice(0, RECENT_ITEMS_LIMIT);

    return {
        totalCount: missionRecordCount + conversationCount + phraseCount + reportCount,
        missionRecordCount,
        conversationCount,
        phraseCount,
        reportCount,
        recentItems,
    };
};

export const searchArchives = async (
    userId: string,
    query: SearchArchivesQueryDto
): Promise<SearchArchivesResponseDto> => {
    const startDate = query.startDate ? new Date(query.startDate) : undefined;
    const endDate = query.endDate ? new Date(`${query.endDate}T23:59:59.999Z`) : undefined;
    const keyword = query.keyword?.trim().toLowerCase();
    const page = query.page ?? DEFAULT_PAGE;
    const size = query.size ?? DEFAULT_SIZE;

    // 미션 처리
    if (query.type === "mission") {
        const result = await searchMissionArchives(userId, { ...query, startDate, endDate, keyword });
        return paginate(result.items, page, size);
    }

    const sort = query.sort === "oldest" ? "asc" : "desc";
    const rows = await archiveRepository.searchArchiveItems({
        userId,
        type: query.type as "conversation" | "phrase" | "report" | undefined,
        startDate,
        endDate,
        sort,
        folderId: query.folderId,
        tags: query.tag ? [query.tag] : undefined,
    });

    const itemsWithTitle: ArchiveSearchItemDto[] = await Promise.all(
        rows.map(async (row) => ({
            id: row.id,
            archiveItemId: row.id,
            referenceId: row.reference_id,
            type: row.item_type as ArchiveItemType,
            title: await resolveItemTitle(row.item_type as "conversation" | "phrase" | "report", row.reference_id),
            tags: (row.tags as string[] | null) ?? [],
            folderId: row.folder_id,
            isBookmarked: true,
            missionId: null,
            missionRecordId: null,
            createdAt: row.created_at.toISOString(),
        }))
    );

    // keyword 검색: title이 여러 테이블에 흩어져 있어 DB join 불가
    // title을 조회한 뒤 애플리케이션 레벨에서 필터링한다.
    // 주의: 나중에 페이지네이션이 추가되면
    // DB에서 N개 가져온 뒤 그중 일부만 keyword에 매칭되는 문제 발생
    // 이 때는 title을 Archive_Items에 비정규화 후 저장하는 방식 고려 필요
    const items = keyword
        ? itemsWithTitle.filter((item) => item.title.toLowerCase().includes(keyword))
        : itemsWithTitle;

    if (query.type) {
        return paginate(items, page, size);
    }

    const missionResult = await searchMissionArchives(userId, {
        ...query,
        startDate,
        endDate,
        keyword,
    });
    const combinedItems = [...items, ...missionResult.items].sort((a, b) =>
        sort === "asc"
            ? a.createdAt.localeCompare(b.createdAt)
            : b.createdAt.localeCompare(a.createdAt)
    );

    return paginate(combinedItems, page, size);
};

// type=mission 전용 검색 경로 (#86: 북마크 기준으로 재설계)
// - base set은 항상 Mission_Saves(북마크)다 — 완료 여부와 무관하게 찜한 미션이 전부 노출된다.
// - missionFilter(all/completed/incomplete)로 그 안에서 완료 여부를 좁힌다.
// - sort(latest/oldest)는 북마크한 시각(Mission_Saves.created_at) 기준 정렬이다.
// - 미션은 folder/tag 개념이 없음(Mission_Saves에 해당 컬럼 없음) -> folderId/tag가 오면 빈 결과 반환.
const searchMissionArchives = async (
    userId: string,
    params: {
        startDate?: Date;
        endDate?: Date;
        sort?: "latest" | "oldest";
        missionFilter?: "all" | "completed" | "incomplete";
        folderId?: string;
        tag?: string;
        keyword?: string;
    }
): Promise<SearchArchivesResponseDto> => {
    // 미션은 폴더/태그 미지원
    if (params.folderId || params.tag) {
        return { totalCount: 0, items: [], pageInfo: { currentPage: 1, totalPages: 1, totalCount: 0 } };
    }

    const prismaSort = params.sort === "oldest" ? "asc" : "desc";
    const missionFilter = params.missionFilter ?? "all";

    const savedRows = await missionRepository.findSavedMissions({
        userId,
        startDate: params.startDate,
        endDate: params.endDate,
        sort: prismaSort,
    });

    const savedMissionIdList = savedRows.map((r) => r.mission.id);
    const savedMissionRecords = savedMissionIdList.length
        ? await missionRepository.findLatestMissionRecordsByMissionIds(userId, savedMissionIdList)
        : [];

    // 미션당 완료 기록(status=completed)이 실제로 만들어지는 유일한 경로라, "완료"는 completed 기록 존재 여부로 판정한다.
    const latestRecordByMissionId = new Map<string, { id: string; status: "in_progress" | "completed" }>();
    for (const record of savedMissionRecords) {
        if (!latestRecordByMissionId.has(record.mission_id)) {
            latestRecordByMissionId.set(record.mission_id, { id: record.id, status: record.status });
        }
    }

    let itemsWithTitle: ArchiveSearchItemDto[] = savedRows.map((row) => {
        const latestRecord = latestRecordByMissionId.get(row.mission.id);
        return {
            id: row.mission.id,
            archiveItemId: null,
            referenceId: row.mission.id,
            type: "mission" as ArchiveItemType,
            title: row.mission.title,
            tags: [],
            folderId: null,
            isBookmarked: true,
            missionStatus: latestRecord?.status ?? null,
            category: row.mission.category,
            difficulty: DIFFICULTY_TO_LABEL[row.mission.difficulty],
            estimatedMinutes: row.mission.estimated_minutes,
            rewardXp: row.mission.reward_xp,
            missionId: row.mission.id,
            missionRecordId: latestRecord?.status === "completed" ? latestRecord.id : null,
            createdAt: row.created_at.toISOString(),
        };
    });

    if (missionFilter === "completed") {
        itemsWithTitle = itemsWithTitle.filter((item) => item.missionStatus === "completed");
    } else if (missionFilter === "incomplete") {
        itemsWithTitle = itemsWithTitle.filter((item) => item.missionStatus !== "completed");
    }

    const items = params.keyword
        ? itemsWithTitle.filter((item) => item.title.toLowerCase().includes(params.keyword!))
        : itemsWithTitle;

    return {
        totalCount: items.length,
        items,
        pageInfo: { currentPage: 1, totalPages: 1, totalCount: items.length },
    };
};

export const getConversationDetail = async (
    userId: string,
    conversationId: string
): Promise<ConversationDetailResponseDto> => {
    const conversation = await archiveRepository.findConversationDetail(conversationId, userId);
    if (!conversation) throw new ArchiveConversationNotFoundError();

    const feedback = conversation.feedbacks[0];

    return {
        conversationId: conversation.id,
        missionTitle: conversation.mission?.title ?? null,
        // 대화 요약은 피드백 생성 시 함께 만들어 저장한다(Feedbacks.conversation_summary).
        // 피드백 생성 전이면 빈 문자열.
        summary: feedback?.conversation_summary ?? "",
        durationMinutes: durationMinutes(conversation.started_at, conversation.finished_at),
        // 대화 요약 칩은 피드백 생성 시 저장된다(Feedbacks.summary_chips).
        summaryChips: toSummaryChips(feedback?.summary_chips),
        messages: conversation.messages.map((m) => ({
            sender: m.role === "user" ? "USER" : "AI",
            content: m.content,
            sentAt: m.created_at.toISOString(),
        })),
        feedback: feedback
            ? {
                feedbackId: feedback.id,
                kindnessScore: feedback.kindness_score ?? 0,
                initiativeScore: feedback.initiative_score ?? 0,
                empathyScore: feedback.empathy_score ?? 0,
                questionLinkScore: feedback.question_link_score ?? 0,
            }
            : null,
    };
};

export const getPhraseDetail = async (
    userId: string,
    phraseId: string
): Promise<PhraseDetailResponseDto> => {
    const phrase = await archiveRepository.findPhraseById(phraseId, userId);
    if (!phrase) throw new PhraseNotFoundError();

    const archiveItem = await archiveRepository.findArchiveItemByReference(userId, "phrase", phraseId);

    return {
        id: phrase.id,
        content: phrase.content,
        memo: phrase.memo,
        missionTitle: phrase.conversation?.mission?.title ?? null,
        conversationId: phrase.conversation_id,
        folderId: archiveItem?.folder_id ?? null,
        summaryChips: toSummaryChips(phrase.conversation?.feedbacks?.[0]?.summary_chips),
        createdAt: phrase.created_at.toISOString(),
    };
};

export const createPhrase = async (
    userId: string,
    body: CreatePhraseRequestDto
): Promise<CreatePhraseResponseDto> => {
    const conversation = await archiveRepository.findConversationById(body.conversationId, userId);
    if (!conversation) throw new ArchiveConversationNotFoundError();

    const phrase = await archiveRepository.createSavedPhrase({
        user: { connect: { id: userId } },
        conversation: { connect: { id: body.conversationId } },
        content: body.content,
        memo: body.memo,
    });

    await archiveRepository.createArchiveItem({
        user: { connect: { id: userId } },
        item_type: "phrase",
        reference_id: phrase.id,
    });

    return {
        id: phrase.id,
        conversationId: body.conversationId,
        content: phrase.content,
        memo: phrase.memo,
        createdAt: phrase.created_at.toISOString(),
    };
};

export const deleteArchiveItem = async (
    userId: string,
    itemId: string
): Promise<DeleteArchiveItemResponseDto> => {
    const item = await archiveRepository.findArchiveItemById(itemId, userId);
    if (!item) throw new ItemNotFoundError();

    if (item.item_type === "phrase") {
        // phrase는 원본까지 완전 삭제
        await archiveRepository.deleteSavedPhraseWithArchiveItem(itemId, item.reference_id);
    } else {
        // conversation/report는 원본 보존, 매핑만 제거
        await archiveRepository.deleteArchiveItem(itemId);
    }

    return { itemId, deleted: true };
};

export const deletePhrase = async (
    userId: string,
    phraseId: string
): Promise<DeleteArchiveItemResponseDto> => {
    const phrase = await archiveRepository.findPhraseById(phraseId, userId);
    if (!phrase) throw new PhraseNotFoundError();

    const item = await archiveRepository.findArchiveItemByReference(userId, "phrase", phraseId);
    if (item) {
        await archiveRepository.deleteSavedPhraseWithArchiveItem(item.id, phraseId);
        return { itemId: item.id, deleted: true };
    }

    await archiveRepository.deleteSavedPhrase(phraseId);
    return { itemId: phraseId, deleted: true };
};

export const listFolders = async (userId: string): Promise<ListFoldersResponseDto> => {
    const folders = await archiveRepository.findFoldersByUser(userId);
    const withCounts = await Promise.all(
        folders.map(async (f) => ({
            id: f.id,
            name: f.name,
            itemCount: await archiveRepository.countItemsByFolder(f.id),
        }))
    );
    return { folders: withCounts };
};

export const createFolder = async (
    userId: string,
    body: CreateFolderRequestDto
): Promise<CreateFolderResponseDto> => {
    const existing = await archiveRepository.findFolderByName(userId, body.name);
    if (existing) throw new DuplicatedError("이미 존재하는 폴더명입니다.");

    const folder = await archiveRepository.createFolder({
        user: { connect: { id: userId } },
        name: body.name,
    });

    return { id: folder.id, name: folder.name };
};

export const updateFolder = async (
    userId: string,
    folderId: string,
    body: UpdateFolderRequestDto
): Promise<UpdateFolderResponseDto> => {
    const folder = await archiveRepository.findFolderById(folderId, userId);
    if (!folder) throw new FolderNotFoundError();

    if (body.name !== folder.name) {
        const existing = await archiveRepository.findFolderByName(userId, body.name);
        if (existing) throw new DuplicatedError("이미 존재하는 폴더명입니다.");
    }

    const updated = await archiveRepository.updateFolderName(folderId, body.name);
    return { id: updated.id, name: updated.name };
};

export const addItemToFolder = async (
    userId: string,
    folderId: string,
    body: AddItemToFolderRequestDto
): Promise<AddItemToFolderResponseDto> => {
    const folder = await archiveRepository.findFolderById(folderId, userId);
    if (!folder) throw new FolderNotFoundError();

    const item = await archiveRepository.findArchiveItemById(body.itemId, userId);
    if (!item) throw new ItemNotFoundError();

    await archiveRepository.updateArchiveItemFolder(body.itemId, folderId);
    return { folderId, itemId: body.itemId };
};
