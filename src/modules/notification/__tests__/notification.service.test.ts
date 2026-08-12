jest.mock("../repositories/notification.repository");
jest.mock("../services/push.service");
jest.mock("../../../config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import * as notificationRepository from "../repositories/notification.repository";
import * as pushService from "../services/push.service";
import { notifyUser, deleteMyNotification, deleteAllMyNotifications } from "../services/notification.service";
import { NotFoundError } from "../../../shared/errors/common.error";

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

// #199 — 알림 삭제 API. 앱이 지금까지 기기에 삭제 목록을 저장해두는 방식으로 우회하던 것을
// 서버에 실제로 반영한다.
describe("deleteMyNotification", () => {
  it("본인 소유의 알림이면 삭제하고 결과를 반환한다", async () => {
    mockedRepo.findNotificationById.mockResolvedValue({ id: "n1" } as never);
    mockedRepo.deleteNotification.mockResolvedValue({} as never);

    const result = await deleteMyNotification("u1", "n1");

    expect(mockedRepo.deleteNotification).toHaveBeenCalledWith("n1");
    expect(result).toEqual({ notificationId: "n1", deleted: true });
  });

  it("존재하지 않거나 본인 소유가 아니면 404를 던지고 삭제를 시도하지 않는다", async () => {
    mockedRepo.findNotificationById.mockResolvedValue(null);

    await expect(deleteMyNotification("u1", "n1")).rejects.toBeInstanceOf(NotFoundError);
    expect(mockedRepo.deleteNotification).not.toHaveBeenCalled();
  });
});

describe("deleteAllMyNotifications", () => {
  it("본인의 알림을 전체 삭제한다", async () => {
    mockedRepo.deleteAllNotifications.mockResolvedValue({ count: 3 } as never);

    await deleteAllMyNotifications("u1");

    expect(mockedRepo.deleteAllNotifications).toHaveBeenCalledWith("u1");
  });
});
