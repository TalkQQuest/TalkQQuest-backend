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
    mockedRepo.deleteNotification.mockResolvedValue({ count: 1 } as never);

    const result = await deleteMyNotification("u1", "n1");

    expect(mockedRepo.deleteNotification).toHaveBeenCalledWith("n1", "u1");
    expect(result).toEqual({ notificationId: "n1", deleted: true });
  });

  // #200 코드래빗 리뷰: 조회 후 삭제 2단계로 나뉘어 있으면 그 사이에 다른 요청이 같은 알림을
  // 먼저 지웠을 때 delete()가 P2025로 500을 던질 수 있었다. id+user_id로 함께 조건을 걸어
  // 원자적으로 처리하고, count로 존재/소유 여부를 판단한다.
  it("존재하지 않거나 본인 소유가 아니면(삭제된 행이 0건) 404를 던진다", async () => {
    mockedRepo.deleteNotification.mockResolvedValue({ count: 0 } as never);

    await expect(deleteMyNotification("u1", "n1")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("deleteAllMyNotifications", () => {
  it("본인의 알림을 전체 삭제한다", async () => {
    mockedRepo.deleteAllNotifications.mockResolvedValue({ count: 3 } as never);

    await deleteAllMyNotifications("u1");

    expect(mockedRepo.deleteAllNotifications).toHaveBeenCalledWith("u1");
  });
});
