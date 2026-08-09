jest.mock("../repositories/notification.repository");
jest.mock("../services/push.service");
jest.mock("../../../config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import * as notificationRepository from "../repositories/notification.repository";
import * as pushService from "../services/push.service";
import { notifyUser } from "../services/notification.service";

const mockedRepo = jest.mocked(notificationRepository);
const mockedPush = jest.mocked(pushService);

beforeEach(() => {
  jest.clearAllMocks();
});

describe("notifyUser", () => {
  it("인앱 알림을 만들고 같은 내용으로 푸시를 발송한다", async () => {
    mockedRepo.createNotification.mockResolvedValue({} as never);
    mockedPush.sendPushToUser.mockResolvedValue(undefined);

    await notifyUser("u1", "report_ready", "제목", "본문", "report-1", "report");

    expect(mockedRepo.createNotification).toHaveBeenCalledWith(
      "u1",
      "report_ready",
      "제목",
      "본문",
      "report-1",
      "report"
    );
    expect(mockedPush.sendPushToUser).toHaveBeenCalledWith("u1", {
      title: "제목",
      body: "본문",
      data: { type: "report_ready", referenceId: "report-1", referenceType: "report" },
    });
  });

  it("푸시 발송이 실패해도 예외를 던지지 않는다(인앱 알림은 이미 생성됨)", async () => {
    mockedRepo.createNotification.mockResolvedValue({} as never);
    mockedPush.sendPushToUser.mockRejectedValue(new Error("fcm down"));

    await expect(notifyUser("u1", "report_ready", "제목")).resolves.toBeUndefined();
    expect(mockedRepo.createNotification).toHaveBeenCalledTimes(1);
  });
});
