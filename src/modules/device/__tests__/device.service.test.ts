import * as deviceRepository from "../repositories/device.repository";
import { registerFcmToken } from "../services/device.service";

jest.mock("../repositories/device.repository");

const mockedRepo = jest.mocked(deviceRepository);

beforeEach(() => {
  jest.clearAllMocks();
});

describe("registerFcmToken", () => {
  it("upsertDeviceToken을 유저/토큰/플랫폼으로 호출하고 registered: true를 반환한다", async () => {
    mockedRepo.upsertDeviceToken.mockResolvedValue({} as never);

    const result = await registerFcmToken("u1", { fcmToken: "token-abc", platform: "android" });

    expect(mockedRepo.upsertDeviceToken).toHaveBeenCalledWith("u1", "token-abc", "android");
    expect(result).toEqual({ registered: true });
  });
});
