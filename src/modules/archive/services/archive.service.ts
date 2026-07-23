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

const RECENT_ITEMS_LIMIT = 10;

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
            const report = await archiveRepository.findReportMeta(referenceId);
            if (!report) return "제목 없음";
            const typeLabel = report.type === "monthly" ? "월간" : "주간";
            return `${report.period} ${typeLabel} 리포트`;
        }
    }
};

export const getArchiveSummary = async (userId: string): Promise<ArchiveSummaryResponseDto> => {
    const [missionRecordCount, conversationCount, phraseCount, reportCount, recentArchiveRows, recentMissionRows] =
        await Promise.all([
            archiveRepository.countMissionRecords(userId),
            archiveRepository.countConversations(userId),
            archiveRepository.countSavedPhrases(userId),
            archiveRepository.countReports(userId),
            archiveRepository.findRecentArchiveItems(userId, RECENT_ITEMS_LIMIT),
            archiveRepository.findRecentMissionRecords(userId, RECENT_ITEMS_LIMIT),
        ]);

    // 최근 미션 기록 중 저장된 것 판별 
    const missionIds = recentMissionRows
        .map((r) => r.mission?.id)
        .filter((id): id is string => !!id);
    const savedRows = missionIds.length
        ? await missionRepository.findSavedMissionIds(userId, missionIds)
        : [];
    const savedMissionIds = new Set(savedRows.map((s) => s.mission_id));

    const archiveItemsResolved = await Promise.all(
        recentArchiveRows.map(async (row) => ({
            id: row.id,
            type: row.item_type as ArchiveItemType,
            title: await resolveItemTitle(row.item_type as "conversation" | "phrase" | "report", row.reference_id),
            isBookmarked: true,
            createdAt: row.created_at.toISOString(),
        }))
    );

    const missionItemsResolved = recentMissionRows.map((row) => ({
        id: row.id,
        type: "mission" as ArchiveItemType,
        title: row.mission?.title ?? "제목 없음",
        isBookmarked: row.mission ? savedMissionIds.has(row.mission.id) : false,
        missionStatus: row.status as "in_progress" | "completed",
        // 완료면 완료 시각, 진행중이면 생성 시각을 활동 시각으로 표시
        createdAt: (row.completed_at ?? row.created_at).toISOString(),
    }));

    const recentItems = [...archiveItemsResolved, ...missionItemsResolved]
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
    const endDate = query.endDate ? new Date(query.endDate) : undefined;
    const keyword = query.keyword?.trim().toLowerCase();

    // 미션 처리
    if (query.type === "mission") {
        return searchMissionArchives(userId, { ...query, startDate, endDate, keyword });
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
            type: row.item_type as ArchiveItemType,
            title: await resolveItemTitle(row.item_type as "conversation" | "phrase" | "report", row.reference_id),
            tags: (row.tags as string[] | null) ?? [],
            folderId: row.folder_id,
            isBookmarked: true,
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

    const totalCount = keyword
        ? items.length
        : await archiveRepository.countArchiveItems({
            userId,
            type: query.type as "conversation" | "phrase" | "report" | undefined,
            startDate,
            endDate,
            folderId: query.folderId,
        });

    return { totalCount, items };
};

// type=mission 전용 검색 경로
// - 저장(북마크) 여부는 Archive_Items가 아니라 Mission_Saves(mission_id 기준)로 판단
// - 미션은 folder/tag 개념이 없음(Mission_Saves에 해당 컬럼 없음) -> folderId/tag가 오면 빈 결과 반환.
// - sort=saved: 저장(찜)한 미션 전체. 수행 기록이 아직 없는(진행중/수행전) 미션도 포함, 저장 시각 기준 정렬.
// - 기본(latest/oldest): 진행중+완료 미션 기록 전체.
const searchMissionArchives = async (
    userId: string,
    params: {
        startDate?: Date;
        endDate?: Date;
        sort?: "latest" | "oldest" | "saved";
        folderId?: string;
        tag?: string;
        keyword?: string;
    }
): Promise<SearchArchivesResponseDto> => {
    // 미션은 폴더/태그 미지원
    if (params.folderId || params.tag) {
        return { totalCount: 0, items: [] };
    }

    const prismaSort = params.sort === "oldest" ? "asc" : "desc";

    if (params.sort === "saved") {
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

        const latestStatusByMissionId = new Map<string, "in_progress" | "completed">();
        for (const record of savedMissionRecords) {
            if (!latestStatusByMissionId.has(record.mission_id)) {
                latestStatusByMissionId.set(record.mission_id, record.status);
            }
        }

        const savedItemsWithTitle: ArchiveSearchItemDto[] = savedRows.map((row) => ({
            id: row.mission.id,
            type: "mission" as ArchiveItemType,
            title: row.mission.title,
            tags: [],
            folderId: null,
            isBookmarked: true,
            missionStatus: latestStatusByMissionId.get(row.mission.id) ?? null,
            createdAt: row.created_at.toISOString(),
        }));

        const savedItems = params.keyword
            ? savedItemsWithTitle.filter((item) => item.title.toLowerCase().includes(params.keyword!))
            : savedItemsWithTitle;

        return { totalCount: savedItems.length, items: savedItems };
    }

    // 기본(latest/oldest): 진행중 + 완료 미션 기록 전체
    const missionRecordRows = await archiveRepository.searchMissionRecords({
        userId,
        startDate: params.startDate,
        endDate: params.endDate,
        sort: prismaSort,
    });

    const missionIdList = missionRecordRows
        .map((r) => r.mission?.id)
        .filter((id): id is string => !!id);
    const savedMissionIdRows = missionIdList.length
        ? await missionRepository.findSavedMissionIds(userId, missionIdList)
        : [];
    const savedMissionIdSet = new Set(savedMissionIdRows.map((s) => s.mission_id));

    const recordItemsWithTitle: ArchiveSearchItemDto[] = missionRecordRows.map((row) => ({
        id: row.id,
        type: "mission" as ArchiveItemType,
        title: row.mission?.title ?? "제목 없음",
        tags: [],
        folderId: null,
        isBookmarked: row.mission ? savedMissionIdSet.has(row.mission.id) : false,
        missionStatus: row.status,
        createdAt: (row.completed_at ?? row.created_at).toISOString(),
    }));

    const recordItems = params.keyword
        ? recordItemsWithTitle.filter((item) => item.title.toLowerCase().includes(params.keyword!))
        : recordItemsWithTitle;

    const totalCount = params.keyword
        ? recordItems.length
        : await archiveRepository.countMissionRecordsFiltered({
            userId,
            startDate: params.startDate,
            endDate: params.endDate,
        });

    return { totalCount, items: recordItems };
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
        // TODO: Conversations.summary 필드가 스키마에 없음
        // AI summary 파이프라인 연결 시 migration 필요
        summary: "",
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