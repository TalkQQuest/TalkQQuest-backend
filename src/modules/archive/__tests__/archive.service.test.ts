jest.mock("../repositories/archive.repository");
jest.mock("../../mission/repositories/mission.repository");

import * as archiveRepository from "../repositories/archive.repository";
import * as missionRepository from "../../mission/repositories/mission.repository";
import { getArchiveSummary, searchArchives, getConversationDetail } from "../services/archive.service";

const mockedArchive = jest.mocked(archiveRepository);
const mockedMission = jest.mocked(missionRepository);

beforeEach(() => {
  jest.clearAllMocks();
  mockedMission.countSavedMissions.mockResolvedValue(0);
  mockedArchive.countConversations.mockResolvedValue(0);
  mockedArchive.countSavedPhrases.mockResolvedValue(0);
  mockedArchive.countReports.mockResolvedValue(0);
  mockedArchive.findRecentArchiveItems.mockResolvedValue([]);
  mockedArchive.findRecentMissionRecords.mockResolvedValue([] as never);
  mockedArchive.findRecentStartedMissions.mockResolvedValue([] as never);
  mockedMission.findSavedMissionIds.mockResolvedValue([] as never);
});

// #145 — 성장 리포트(report)와 저장된 주간 비교 리포트(weekly_compare)는 아카이브에서
// 하나의 type="report" 묶음으로 노출되고 reportType으로 구분된다(미션이 missionStatus로
// 완료/진행중을 나누는 것과 같은 방식).
describe("getArchiveSummary — 리포트 묶음(report/weekly_compare)", () => {
  it("weekly_compare 항목은 type=report, reportType=weekly_compare로 노출되고 제목은 주차 기준이다", async () => {
    mockedArchive.findRecentArchiveItems.mockResolvedValue([
      {
        id: "a1",
        reference_id: "w1",
        item_type: "weekly_compare",
        created_at: new Date("2026-08-08T00:00:00Z"),
      },
    ] as never);
    mockedArchive.findWeeklyCompareReportWeekIndex.mockResolvedValue({ week_index: 3 } as never);

    const result = await getArchiveSummary("u1");

    expect(result.recentItems).toHaveLength(1);
    expect(result.recentItems[0]).toMatchObject({
      type: "report",
      reportType: "weekly_compare",
      title: "3주차 비교 리포트",
    });
  });

  it("report 항목은 type=report, reportType=growth로 노출된다", async () => {
    mockedArchive.findRecentArchiveItems.mockResolvedValue([
      {
        id: "a2",
        reference_id: "r1",
        item_type: "report",
        created_at: new Date("2026-08-08T00:00:00Z"),
      },
    ] as never);
    mockedArchive.findReportData.mockResolvedValue({ data: { title: "카페 미션 리포트" } } as never);

    const result = await getArchiveSummary("u1");

    expect(result.recentItems[0]).toMatchObject({
      type: "report",
      reportType: "growth",
      title: "카페 미션 리포트",
    });
  });

  it("reportCount는 report와 weekly_compare 합계다(레포지토리 위임 확인)", async () => {
    mockedArchive.countReports.mockResolvedValue(7);

    const result = await getArchiveSummary("u1");

    expect(result.reportCount).toBe(7);
  });

  it("report 항목은 conversation처럼 undefined가 아니라 Archive_Items.tags를 그대로 쓴다", async () => {
    mockedArchive.findRecentArchiveItems.mockResolvedValue([
      {
        id: "a2",
        reference_id: "r1",
        item_type: "report",
        tags: ["기존태그"],
        created_at: new Date("2026-08-08T00:00:00Z"),
      },
    ] as never);
    mockedArchive.findReportData.mockResolvedValue({ data: { title: "카페 미션 리포트" } } as never);

    const result = await getArchiveSummary("u1");

    expect(result.recentItems[0].tags).toEqual(["기존태그"]);
  });

  it("phrase 항목처럼 Archive_Items.tags가 null이면 빈 배열로 내려간다(undefined 아님)", async () => {
    mockedArchive.findRecentArchiveItems.mockResolvedValue([
      {
        id: "a5",
        reference_id: "p1",
        item_type: "phrase",
        tags: null,
        created_at: new Date("2026-08-08T00:00:00Z"),
      },
    ] as never);
    mockedArchive.findSavedPhraseContent.mockResolvedValue({ content: "오늘 날씨가 좋네요." } as never);

    const result = await getArchiveSummary("u1");

    expect(result.recentItems[0].tags).toEqual([]);
  });
});

describe("searchArchives — type=report 조회", () => {
  it("type=report로 검색하면 weekly_compare도 함께 매핑되어 반환된다", async () => {
    mockedArchive.searchArchiveItems.mockResolvedValue([
      {
        id: "a1",
        reference_id: "w1",
        item_type: "weekly_compare",
        tags: null,
        folder_id: null,
        created_at: new Date("2026-08-08T00:00:00Z"),
      },
    ] as never);
    mockedArchive.findWeeklyCompareReportWeekIndex.mockResolvedValue({ week_index: 2 } as never);

    const result = await searchArchives("u1", { type: "report" });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ type: "report", reportType: "weekly_compare" });
  });
});

// #154/#155/#169 — 대화 카드에 AI 요약(칩/설명)을 함께 보여준다. tags는 지금까지 아무도 채우지
// 않던 Archive_Items.tags 컬럼을 대신해, conversation 타입에 한해 Feedbacks.summary_chips에서
// 조회 시점에 계산한 값을 돌려준다(DB 컬럼에는 쓰지 않는다). N+1을 피하기 위해 목록에 등장하는
// conversationId를 모아 한 번의 IN 쿼리(findConversationSummaryInfoByIds)로 조회한다.
// 카드의 description은 상세용 conversation_summary가 아니라 카드 전용 축약 요약인
// card_summary를 쓴다(#169).
describe("conversation 타입 — AI 요약 칩/설명(#154, #155, #169)", () => {
  const conversationRow = {
    id: "a3",
    reference_id: "c1",
    item_type: "conversation",
    created_at: new Date("2026-08-08T00:00:00Z"),
  };

  beforeEach(() => {
    mockedArchive.findConversationTitle.mockResolvedValue({
      mission: { title: "카페 직원에게 웃으며 인사하기" },
    } as never);
    mockedArchive.findConversationSummaryInfoByIds.mockResolvedValue([]);
  });

  it("getArchiveSummary — 피드백이 있으면 칩 앞 2개와 카드 요약을 반환한다", async () => {
    mockedArchive.findRecentArchiveItems.mockResolvedValue([conversationRow] as never);
    mockedArchive.findConversationSummaryInfoByIds.mockResolvedValue([
      {
        conversation_id: "c1",
        card_summary: "처음 만난 사람에게 먼저 인사를 건네고 가벼운 질문으로 대화를 이어갔어요.",
        summary_chips: ["첫 만남", "취미", "스몰토크"],
      },
    ] as never);

    const result = await getArchiveSummary("u1");

    expect(result.recentItems[0]).toMatchObject({
      type: "conversation",
      tags: ["첫 만남", "취미"],
      description: "처음 만난 사람에게 먼저 인사를 건네고 가벼운 질문으로 대화를 이어갔어요.",
    });
    expect(mockedArchive.findConversationSummaryInfoByIds).toHaveBeenCalledTimes(1);
    expect(mockedArchive.findConversationSummaryInfoByIds).toHaveBeenCalledWith(["c1"]);
  });

  it("getArchiveSummary — 피드백이 아직 없으면(pending) 빈 배열/null을 반환한다", async () => {
    mockedArchive.findRecentArchiveItems.mockResolvedValue([conversationRow] as never);
    mockedArchive.findConversationSummaryInfoByIds.mockResolvedValue([]);

    const result = await getArchiveSummary("u1");

    expect(result.recentItems[0]).toMatchObject({ tags: [], description: null });
  });

  it("getArchiveSummary — 칩이 1개뿐이면 그 1개만 반환한다", async () => {
    mockedArchive.findRecentArchiveItems.mockResolvedValue([conversationRow] as never);
    mockedArchive.findConversationSummaryInfoByIds.mockResolvedValue([
      { conversation_id: "c1", card_summary: "짧게 인사했어요.", summary_chips: ["첫 만남"] },
    ] as never);

    const result = await getArchiveSummary("u1");

    expect(result.recentItems[0]).toMatchObject({ tags: ["첫 만남"] });
  });

  it("getArchiveSummary — summary_chips가 배열이 아니면(형식 오류 데이터) 빈 배열로 처리한다", async () => {
    mockedArchive.findRecentArchiveItems.mockResolvedValue([conversationRow] as never);
    mockedArchive.findConversationSummaryInfoByIds.mockResolvedValue([
      { conversation_id: "c1", card_summary: "요약", summary_chips: "잘못된형식" },
    ] as never);

    const result = await getArchiveSummary("u1");

    expect(result.recentItems[0]).toMatchObject({ tags: [] });
  });

  it("searchArchives — conversation이 여러 건이어도 요약 조회는 한 번만 일어난다(N+1 방지)", async () => {
    mockedArchive.searchArchiveItems.mockResolvedValue([
      { ...conversationRow, id: "a3", reference_id: "c1", tags: null, folder_id: null },
      { ...conversationRow, id: "a4", reference_id: "c2", tags: null, folder_id: null },
      { ...conversationRow, id: "a5", reference_id: "c3", tags: null, folder_id: null },
    ] as never);
    mockedArchive.findConversationSummaryInfoByIds.mockResolvedValue([
      { conversation_id: "c1", card_summary: "요약1", summary_chips: ["a", "b"] },
      { conversation_id: "c2", card_summary: "요약2", summary_chips: ["c", "d"] },
    ] as never);

    const result = await searchArchives("u1", { type: "conversation" });

    expect(result.items).toHaveLength(3);
    expect(result.items.find((i) => i.referenceId === "c1")).toMatchObject({ description: "요약1" });
    expect(result.items.find((i) => i.referenceId === "c2")).toMatchObject({ description: "요약2" });
    expect(result.items.find((i) => i.referenceId === "c3")).toMatchObject({ tags: [], description: null });
    expect(mockedArchive.findConversationSummaryInfoByIds).toHaveBeenCalledTimes(1);
    expect(mockedArchive.findConversationSummaryInfoByIds).toHaveBeenCalledWith(["c1", "c2", "c3"]);
  });

  it("searchArchives — conversation 외 타입은 기존처럼 Archive_Items.tags를 그대로 쓰고, 요약 조회를 하지 않는다", async () => {
    mockedArchive.searchArchiveItems.mockResolvedValue([
      {
        id: "a4",
        reference_id: "p1",
        item_type: "phrase",
        tags: ["일상"],
        folder_id: null,
        created_at: new Date("2026-08-08T00:00:00Z"),
      },
    ] as never);
    mockedArchive.findSavedPhraseContent.mockResolvedValue({ content: "오늘 날씨가 좋네요." } as never);

    const result = await searchArchives("u1", { type: "phrase" });

    expect(result.items[0].tags).toEqual(["일상"]);
    expect(mockedArchive.findConversationSummaryInfoByIds).not.toHaveBeenCalled();
  });

  it("?tag= 검색 시 summary_chips 기준으로 필터링된다 (DB의 Archive_Items.tags가 아님)", async () => {
    mockedArchive.searchArchiveItems.mockResolvedValue([
      { ...conversationRow, tags: null, folder_id: null },
    ] as never);
    mockedArchive.findConversationSummaryInfoByIds.mockResolvedValue([
      { conversation_id: "c1", card_summary: "취미 이야기", summary_chips: ["첫 만남", "취미"] },
    ] as never);

    const matched = await searchArchives("u1", { type: "conversation", tag: "취미" });
    expect(matched.items).toHaveLength(1);

    const unmatched = await searchArchives("u1", { type: "conversation", tag: "존재안함" });
    expect(unmatched.items).toHaveLength(0);

    expect(mockedArchive.searchArchiveItems).toHaveBeenCalledWith(
      expect.not.objectContaining({ tags: expect.anything() })
    );
  });
});

// #169 회귀 테스트 — 재시도(retryFeedback)는 status만 pending으로 되돌리고 이전
// conversation_summary/summary_chips/conversation_highlights는 지우지 않는다. status가
// ready일 때만 요약 관련 필드를 노출해야, 재생성 중인 대화에서 낡은 값이 보이지 않는다.
describe("getConversationDetail — 재생성 중(pending/failed) 요약 숨김(#169)", () => {
  const baseConversation = {
    id: "c1",
    mission: { title: "카페 인사하기" },
    started_at: new Date("2026-08-10T00:00:00Z"),
    finished_at: new Date("2026-08-10T00:10:00Z"),
    messages: [],
  };

  const staleFeedback = {
    id: "f1",
    status: "pending",
    conversation_summary: "예전 요약입니다.",
    summary_chips: ["예전칩1", "예전칩2", "예전칩3"],
    conversation_highlights: ["예전 흐름1", "예전 흐름2"],
    kindness_score: 80,
    initiative_score: 70,
    empathy_score: 60,
    question_link_score: 50,
  };

  it("피드백이 pending(재생성 중)이면 summary/summaryChips/keyPoints는 빈 값을 반환한다", async () => {
    mockedArchive.findConversationDetail.mockResolvedValue({
      ...baseConversation,
      feedbacks: [staleFeedback],
    } as never);

    const result = await getConversationDetail("u1", "c1");

    expect(result.summary).toBe("");
    expect(result.summaryChips).toEqual([]);
    expect(result.keyPoints).toEqual([]);
    // feedback 객체(점수) 자체는 status와 무관하게 그대로 노출한다(기존 정책 유지).
    expect(result.feedback).toMatchObject({ feedbackId: "f1", kindnessScore: 80 });
  });

  it("피드백이 failed면 summary/summaryChips/keyPoints는 빈 값을 반환한다", async () => {
    mockedArchive.findConversationDetail.mockResolvedValue({
      ...baseConversation,
      feedbacks: [{ ...staleFeedback, status: "failed" }],
    } as never);

    const result = await getConversationDetail("u1", "c1");

    expect(result.summary).toBe("");
    expect(result.summaryChips).toEqual([]);
    expect(result.keyPoints).toEqual([]);
  });

  it("피드백이 ready면 summary/summaryChips/keyPoints를 그대로 반환한다", async () => {
    mockedArchive.findConversationDetail.mockResolvedValue({
      ...baseConversation,
      feedbacks: [{ ...staleFeedback, status: "ready" }],
    } as never);

    const result = await getConversationDetail("u1", "c1");

    expect(result.summary).toBe("예전 요약입니다.");
    expect(result.summaryChips).toEqual(["예전칩1", "예전칩2", "예전칩3"]);
    expect(result.keyPoints).toEqual(["예전 흐름1", "예전 흐름2"]);
  });
});