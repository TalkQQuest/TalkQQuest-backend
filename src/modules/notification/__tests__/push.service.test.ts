jest.mock("../../../config/firebase");
jest.mock("../../device/repositories/device.repository");
jest.mock("../../../config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { getFirebaseMessaging } from "../../../config/firebase";
import * as deviceRepository from "../../device/repositories/device.repository";
import { sendPushToUser } from "../services/push.service";

const mockedGetMessaging = jest.mocked(getFirebaseMessaging);
const mockedRepo = jest.mocked(deviceRepository);

beforeEach(() => {
  jest.clearAllMocks();
});

describe("sendPushToUser", () => {
  // 회귀 테스트(#166): getFirebaseMessaging()이 Firebase 초기화 오류(예: malformed PEM
  // private key)로 동기 throw해도, sendPushToUser는 이 예외를 흡수하고 조용히 resolve해야 한다.
  it("getFirebaseMessaging()이 동기적으로 throw해도 reject하지 않고 조용히 끝난다", async () => {
    mockedGetMessaging.mockImplementation(() => {
      throw new Error("Failed to parse private key: Invalid PEM formatted message");
    });

    await expect(
      sendPushToUser("u1", { title: "t", body: "b", data: { type: "report_ready" } })
    ).resolves.toBeUndefined();
    expect(mockedRepo.findDeviceTokensByUserId).not.toHaveBeenCalled();
  });

  it("Firebase가 설정 안 돼 있으면(null) 조용히 건너뛴다", async () => {
    mockedGetMessaging.mockReturnValue(null);

    await sendPushToUser("u1", { title: "t", body: "b", data: { type: "report_ready" } });

    expect(mockedRepo.findDeviceTokensByUserId).not.toHaveBeenCalled();
  });

  it("등록된 토큰이 없으면 발송을 시도하지 않는다", async () => {
    mockedGetMessaging.mockReturnValue({ send: jest.fn() } as never);
    mockedRepo.findDeviceTokensByUserId.mockResolvedValue([]);

    await sendPushToUser("u1", { title: "t", body: "b", data: { type: "report_ready" } });

    expect(mockedRepo.findDeviceTokensByUserId).toHaveBeenCalledWith("u1");
  });

  it("등록된 토큰마다 notification/data 페이로드를 실어 발송한다", async () => {
    const send = jest.fn().mockResolvedValue("message-id");
    mockedGetMessaging.mockReturnValue({ send } as never);
    mockedRepo.findDeviceTokensByUserId.mockResolvedValue([
      { id: "d1", fcm_token: "token-1" },
      { id: "d2", fcm_token: "token-2" },
    ] as never);

    await sendPushToUser("u1", {
      title: "성장 리포트가 도착했어요!",
      body: "이번 주 성장 리포트를 확인해보세요.",
      data: { type: "report_ready", referenceId: "report-1", referenceType: "report" },
    });

    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledWith({
      token: "token-1",
      notification: { title: "성장 리포트가 도착했어요!", body: "이번 주 성장 리포트를 확인해보세요." },
      data: { type: "report_ready", referenceId: "report-1", referenceType: "report" },
    });
  });

  it("유효하지 않은 토큰 에러(messaging/registration-token-not-registered)면 해당 토큰을 지운다", async () => {
    const send = jest.fn().mockRejectedValue({ code: "messaging/registration-token-not-registered" });
    mockedGetMessaging.mockReturnValue({ send } as never);
    mockedRepo.findDeviceTokensByUserId.mockResolvedValue([{ id: "d1", fcm_token: "dead-token" }] as never);

    await sendPushToUser("u1", { title: "t", body: "b", data: { type: "report_ready" } });

    expect(mockedRepo.deleteDeviceTokenByToken).toHaveBeenCalledWith("dead-token");
  });

  it("그 외 발송 실패는 토큰을 지우지 않고 조용히 넘어간다(다른 토큰 발송은 계속됨)", async () => {
    const send = jest
      .fn()
      .mockRejectedValueOnce({ code: "messaging/internal-error" })
      .mockResolvedValueOnce("message-id");
    mockedGetMessaging.mockReturnValue({ send } as never);
    mockedRepo.findDeviceTokensByUserId.mockResolvedValue([
      { id: "d1", fcm_token: "token-1" },
      { id: "d2", fcm_token: "token-2" },
    ] as never);

    await sendPushToUser("u1", { title: "t", body: "b", data: { type: "report_ready" } });

    expect(mockedRepo.deleteDeviceTokenByToken).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(2);
  });

  // 회귀 테스트: sendPushToUser는 스스로 "절대 reject하지 않는다"고 약속하는 함수다.
  // findDeviceTokensByUserId/deleteDeviceTokenByToken이 실패해도 그 약속을 지켜야 한다.
  it("토큰 조회 자체가 실패해도 reject하지 않고 조용히 끝난다", async () => {
    mockedGetMessaging.mockReturnValue({ send: jest.fn() } as never);
    mockedRepo.findDeviceTokensByUserId.mockRejectedValue(new Error("db down"));

    await expect(
      sendPushToUser("u1", { title: "t", body: "b", data: { type: "report_ready" } })
    ).resolves.toBeUndefined();
  });

  it("무효 토큰 삭제가 실패해도 reject하지 않고, 다른 토큰 발송은 계속된다", async () => {
    const send = jest
      .fn()
      .mockRejectedValueOnce({ code: "messaging/registration-token-not-registered" })
      .mockResolvedValueOnce("message-id");
    mockedGetMessaging.mockReturnValue({ send } as never);
    mockedRepo.findDeviceTokensByUserId.mockResolvedValue([
      { id: "d1", fcm_token: "dead-token" },
      { id: "d2", fcm_token: "token-2" },
    ] as never);
    mockedRepo.deleteDeviceTokenByToken.mockRejectedValue(new Error("delete failed"));

    await expect(
      sendPushToUser("u1", { title: "t", body: "b", data: { type: "report_ready" } })
    ).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(2);
  });
});
