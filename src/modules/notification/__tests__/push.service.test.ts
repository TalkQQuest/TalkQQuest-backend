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
});
