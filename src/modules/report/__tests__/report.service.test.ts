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
import { saveReport } from "../services/report.service";
import { ReportConversationNotFoundError } from "../errors/report.error";

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

    const result = await saveReport("u1", "c1");

    expect(result.reportId).toBe("r1");
    expect(mockedGrowth.getGrowthReport).not.toHaveBeenCalled();
    expect(mockedRepo.createReport).not.toHaveBeenCalled();
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

  it("동시에 같은 대화로 두 번 저장 요청이 오면(P2002) 먼저 만들어진 결과를 반환한다", async () => {
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

    const result = await saveReport("u1", "c1");

    expect(result.reportId).toBe("r-winner");
    expect(mockedArchive.createArchiveItem).not.toHaveBeenCalled();
  });
});
