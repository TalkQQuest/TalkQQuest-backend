jest.mock("../../../config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../../../config/database", () => ({
  prisma: { $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn({})) },
}));
jest.mock("../repositories/report.repository");
jest.mock("../../archive/repositories/archive.repository");
jest.mock("../../notification/repositories/notification.repository");
jest.mock("../services/growth.service");

import { Prisma } from "@prisma/client";
import * as reportRepository from "../repositories/report.repository";
import * as archiveRepository from "../../archive/repositories/archive.repository";
import * as notificationRepository from "../../notification/repositories/notification.repository";
import * as growthService from "../services/growth.service";
import { saveReport, saveWeeklyCompareReport, deleteWeeklyCompareReport } from "../services/report.service";
import { ReportConversationNotFoundError, WeeklyCompareReportNotFoundError } from "../errors/report.error";

const mockedRepo = jest.mocked(reportRepository);
const mockedArchive = jest.mocked(archiveRepository);
const mockedNotification = jest.mocked(notificationRepository);
const mockedGrowth = jest.mocked(growthService);

const growthReport = {
  levelBefore: 1,
  levelAfter: 1,
  weeklyTrend: [],
  trendChangeRate: 0,
  topCategories: [],
  missionProgress: { completed: 0, total: 0 },
  growthTotals: { kindnessTotal: 0, initiativeTotal: 0, empathyTotal: 0, questionLinkTotal: 0 },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedRepo.findConversationByIdAndUserId.mockResolvedValue({
    id: "c1",
    mission: { title: "카페에서 음료 추천 물어보기" },
  } as never);
  mockedGrowth.getGrowthReport.mockResolvedValue(growthReport as never);
  mockedGrowth.getGrowthWindowStart.mockReturnValue(new Date("2026-07-08T00:00:00Z"));
  mockedNotification.findNotificationSettings.mockResolvedValue({ report_ready: true } as never);
  mockedArchive.findArchiveItemByReference.mockResolvedValue(null);
});

describe("saveReport", () => {
  it("존재하지 않거나 남의 대화면 거부한다", async () => {
    mockedRepo.findConversationByIdAndUserId.mockResolvedValue(null);

    await expect(saveReport("u1", "c1")).rejects.toBeInstanceOf(ReportConversationNotFoundError);
    expect(mockedRepo.createReport).not.toHaveBeenCalled();
  });

  it("같은 대화로 이미 저장된 리포트가 있으면 새로 계산하지 않고 그대로 반환한다", async () => {
    mockedRepo.findReportByConversationId.mockResolvedValue({
      id: "r1",
      period: "2026-07-01~2026-07-29",
      created_at: new Date("2026-07-29T00:00:00Z"),
    } as never);
    mockedArchive.findArchiveItemByReference.mockResolvedValue(null);

    const result = await saveReport("u1", "c1");

    expect(result.reportId).toBe("r1");
    expect(mockedGrowth.getGrowthReport).not.toHaveBeenCalled();
    expect(mockedRepo.createReport).not.toHaveBeenCalled();
  });

  it("이미 저장된 리포트인데 Archive 항목이 누락돼 있으면(이전 요청 부분 실패) 재요청 시 복구한다", async () => {
    mockedRepo.findReportByConversationId.mockResolvedValue({
      id: "r1",
      period: "2026-07-01~2026-07-29",
      created_at: new Date("2026-07-29T00:00:00Z"),
    } as never);
    mockedArchive.findArchiveItemByReference.mockResolvedValue(null); // Archive 항목 없음

    await saveReport("u1", "c1");

    expect(mockedArchive.createArchiveItem).toHaveBeenCalledWith(
      expect.objectContaining({ item_type: "report", reference_id: "r1" })
    );
  });

  it("이미 저장된 리포트에 Archive 항목도 있으면 중복 생성하지 않는다", async () => {
    mockedRepo.findReportByConversationId.mockResolvedValue({
      id: "r1",
      period: "2026-07-01~2026-07-29",
      created_at: new Date("2026-07-29T00:00:00Z"),
    } as never);
    mockedArchive.findArchiveItemByReference.mockResolvedValue({
      id: "a1",
      created_at: new Date("2026-07-29T00:00:00Z"),
    } as never);

    await saveReport("u1", "c1");

    expect(mockedArchive.createArchiveItem).not.toHaveBeenCalled();
  });

  it("처음 저장하면 성장 리포트를 계산해 저장하고 Archive/알림을 함께 만든다", async () => {
    mockedRepo.findReportByConversationId.mockResolvedValue(null);
    mockedRepo.createReport.mockResolvedValue({
      id: "r-new",
      created_at: new Date("2026-08-05T00:00:00Z"),
    } as never);

    const result = await saveReport("u1", "c1");

    expect(result.reportId).toBe("r-new");
    expect(mockedArchive.createArchiveItem).toHaveBeenCalledWith(
      expect.objectContaining({ item_type: "report", reference_id: "r-new" })
    );
    expect(mockedNotification.createNotification).toHaveBeenCalled();
  });

  it("동시에 같은 대화로 두 번 저장 요청이 오면(P2002) 먼저 만들어진 결과를 반환하고, 진 요청이 승자를 대신해 Archive 항목을 만든다", async () => {
    mockedRepo.findReportByConversationId
      .mockResolvedValueOnce(null) // 최초 조회 시점엔 아직 없음
      .mockResolvedValueOnce({
        id: "r-winner",
        period: "2026-07-01~2026-07-29",
        created_at: new Date("2026-07-29T00:00:00Z"),
      } as never); // 경합에 진 뒤 다시 조회하면 승자가 있음
    mockedRepo.createReport.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "5.22.0" })
    );
    mockedArchive.findArchiveItemByReference.mockResolvedValue(null);

    const result = await saveReport("u1", "c1");

    expect(result.reportId).toBe("r-winner");
    expect(mockedArchive.createArchiveItem).toHaveBeenCalledWith(
      expect.objectContaining({ item_type: "report", reference_id: "r-winner" })
    );
  });

  // ensureArchived 자체의 P2002 경합 경로: Reports 저장은 성공했지만, 그 직후 Archive_Items를
  // 만드는 시점에 동시 요청과 경합해서 P2002가 나는 경우 — 승자 Archive 항목을 다시 읽어와야 한다.
  it("Archive 항목 생성이 P2002로 경합하면 승자 항목을 다시 읽어 성공 처리한다", async () => {
    mockedRepo.findReportByConversationId.mockResolvedValue(null);
    mockedRepo.createReport.mockResolvedValue({
      id: "r-new",
      created_at: new Date("2026-08-05T00:00:00Z"),
    } as never);
    mockedArchive.findArchiveItemByReference
      .mockResolvedValueOnce(null) // ensureArchived 최초 조회 시점엔 아직 없음
      .mockResolvedValueOnce({ id: "a-winner", created_at: new Date("2026-08-05T00:00:01Z") } as never); // 경합 후 재조회
    mockedArchive.createArchiveItem.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "5.22.0" })
    );

    const result = await saveReport("u1", "c1");

    expect(result.reportId).toBe("r-new");
    expect(mockedArchive.findArchiveItemByReference).toHaveBeenCalledTimes(2);
  });
});

describe("saveWeeklyCompareReport", () => {
  it("존재하지 않는 리포트면 거부한다", async () => {
    mockedRepo.findWeeklyCompareReportByIdAndUserId.mockResolvedValue(null);

    await expect(saveWeeklyCompareReport("u1", "w1")).rejects.toBeInstanceOf(WeeklyCompareReportNotFoundError);
  });

  it("이미 저장돼 있으면 중복 생성하지 않고 그대로 반환한다", async () => {
    mockedRepo.findWeeklyCompareReportByIdAndUserId.mockResolvedValue({ id: "w1" } as never);
    mockedArchive.findArchiveItemByReference.mockResolvedValue({
      id: "a1",
      created_at: new Date("2026-08-08T00:00:00Z"),
    } as never);

    const result = await saveWeeklyCompareReport("u1", "w1");

    expect(result.weeklyCompareReportId).toBe("w1");
    expect(mockedArchive.createArchiveItem).not.toHaveBeenCalled();
  });

  it("처음 저장하면 Archive 항목을 만든다", async () => {
    mockedRepo.findWeeklyCompareReportByIdAndUserId.mockResolvedValue({ id: "w1" } as never);
    mockedArchive.findArchiveItemByReference.mockResolvedValue(null);
    mockedArchive.createArchiveItem.mockResolvedValue({
      id: "a1",
      created_at: new Date("2026-08-08T00:00:00Z"),
    } as never);

    const result = await saveWeeklyCompareReport("u1", "w1");

    expect(result.weeklyCompareReportId).toBe("w1");
    expect(mockedArchive.createArchiveItem).toHaveBeenCalledWith(
      expect.objectContaining({ item_type: "weekly_compare", reference_id: "w1" })
    );
  });

  it("Archive 항목 생성이 P2002로 경합하면 승자 항목을 다시 읽어 성공 처리한다", async () => {
    mockedRepo.findWeeklyCompareReportByIdAndUserId.mockResolvedValue({ id: "w1" } as never);
    mockedArchive.findArchiveItemByReference
      .mockResolvedValueOnce(null) // 최초 조회 시점엔 아직 없음
      .mockResolvedValueOnce({ id: "a-winner", created_at: new Date("2026-08-08T00:00:01Z") } as never); // 경합 후 재조회
    mockedArchive.createArchiveItem.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "5.22.0" })
    );

    const result = await saveWeeklyCompareReport("u1", "w1");

    expect(result).toEqual({ weeklyCompareReportId: "w1", savedAt: "2026-08-08T00:00:01.000Z" });
    expect(mockedArchive.findArchiveItemByReference).toHaveBeenCalledTimes(2);
  });
});

describe("deleteWeeklyCompareReport", () => {
  it("존재하지 않는 리포트면 거부한다", async () => {
    mockedRepo.findWeeklyCompareReportByIdAndUserId.mockResolvedValue(null);

    await expect(deleteWeeklyCompareReport("u1", "w1")).rejects.toBeInstanceOf(WeeklyCompareReportNotFoundError);
  });

  it("저장(Archive)돼 있지 않은 리포트면 거부한다", async () => {
    mockedRepo.findWeeklyCompareReportByIdAndUserId.mockResolvedValue({ id: "w1" } as never);
    mockedArchive.findArchiveItemByReference.mockResolvedValue(null);

    await expect(deleteWeeklyCompareReport("u1", "w1")).rejects.toBeInstanceOf(WeeklyCompareReportNotFoundError);
  });

  // 회귀 테스트: "저장 해제"는 Archive 항목만 지워야 하고, 자동 생성된 원본 스냅샷
  // (Weekly_Compare_Reports 행)은 지우면 안 된다 — 지우면 unique(user_id, week_index) 제약 때문에
  // 그 주차가 다시 생성되지도 않아 영구히 사라진다(코드래빗이 지적한 Critical 버그).
  it("저장 해제 시 Archive 항목만 지우고 원본 주간 리포트 데이터는 남긴다", async () => {
    mockedRepo.findWeeklyCompareReportByIdAndUserId.mockResolvedValue({ id: "w1" } as never);
    mockedArchive.findArchiveItemByReference.mockResolvedValue({ id: "a1" } as never);

    const result = await deleteWeeklyCompareReport("u1", "w1");

    expect(result).toEqual({ weeklyCompareReportId: "w1", deleted: true });
    expect(mockedArchive.deleteArchiveItem).toHaveBeenCalledWith("a1");
    expect(mockedRepo.deleteWeeklyCompareReport).not.toHaveBeenCalled();
  });
});
