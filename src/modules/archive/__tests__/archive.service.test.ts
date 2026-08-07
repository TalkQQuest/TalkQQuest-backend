jest.mock("../repositories/archive.repository");
jest.mock("../../mission/repositories/mission.repository");

import * as archiveRepository from "../repositories/archive.repository";
import * as missionRepository from "../../mission/repositories/mission.repository";
import { getArchiveSummary, searchArchives } from "../services/archive.service";

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
