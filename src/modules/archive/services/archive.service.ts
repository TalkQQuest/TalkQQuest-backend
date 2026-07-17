import { NotFoundError } from "../../../shared/errors/common.error";
import * as archiveRepository from "../repositories/archive.repository";
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

const resolveItemTitle = async (itemType: ArchiveItemType, referenceId: string): Promise<string> => {
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
    const [missionRecordCount, conversationCount, phraseCount, reportCount, recentRows] = await Promise.all([
        archiveRepository.countMissionRecords(userId),
        archiveRepository.countConversations(userId),
        archiveRepository.countSavedPhrases(userId),
        archiveRepository.countReports(userId),
        archiveRepository.findRecentArchiveItems(userId, RECENT_ITEMS_LIMIT),
    ]);

    const recentItems = await Promise.all(
        recentRows.map(async (row) => ({
            id: row.id,
            type: row.item_type as ArchiveItemType,
            title: await resolveItemTitle(row.item_type as ArchiveItemType, row.reference_id),
            createdAt: row.created_at.toISOString(),
        }))
    );

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
    const sort = query.sort === "oldest" ? "asc" : "desc";
    const startDate = query.startDate ? new Date(query.startDate) : undefined;
    const endDate = query.endDate ? new Date(query.endDate) : undefined;

    const rows = await archiveRepository.searchArchiveItems({
        userId,
        type: query.type,
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
            title: await resolveItemTitle(row.item_type as ArchiveItemType, row.reference_id),
            tags: (row.tags as string[] | null) ?? [],
            folderId: row.folder_id,
            createdAt: row.created_at.toISOString(),
        }))
    );

    // keyword 검색: title이 여러 테이블에 흩어져 있어 DB join 불가
    // title을 조회한 뒤 애플리케이션 레벨에서 필터링한다.
    // 주의: 나중에 페이지네이션이 추가되면
    // DB에서 N개 가져온 뒤 그중 일부만 keyword에 매칭되는 문제 발생
    // 이 때는 title을 Archive_Items에 비정규화 후 저장하는 방식 고려 필요
    const keyword = query.keyword?.trim().toLowerCase();
    const items = keyword
        ? itemsWithTitle.filter((item) => item.title.toLowerCase().includes(keyword))
        : itemsWithTitle;

    const totalCount = keyword
        ? items.length
        : await archiveRepository.countArchiveItems({
            userId,
            type: query.type,
            startDate,
            endDate,
            folderId: query.folderId,
        });

    return { totalCount, items };
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

    // 아카이브 삭제는 Archive_Items 매핑만 제거하고 원본은 보존
    await archiveRepository.deleteArchiveItem(itemId);

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