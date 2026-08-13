jest.mock("../repositories/settings.repository");

import * as settingsRepository from "../repositories/settings.repository";
import { getSettings, updateSettingsService } from "../services/settings.service";

const mockedRepo = jest.mocked(settingsRepository);

beforeEach(() => {
  jest.clearAllMocks();
});

// #215 — 회원가입 시점에 Notification_Settings 행이 생성되지 않아 GET/PATCH
// /users/me/settings가 항상 404였다. upsert로 처리해 없으면 즉시 생성한다.
describe("설정 조회/수정 (#215)", () => {
  const settingsRow = {
    id: "s1",
    user_id: "u1",
    mission_reminder: true,
    mission_reminder_time: "09:00",
    community_approved: true,
    report_ready: true,
    marketing: false,
    updated_at: new Date(),
  };

  it("설정이 없는 사용자도 404 대신 기본값으로 즉시 생성해서 반환한다", async () => {
    mockedRepo.upsertSettings.mockResolvedValue(settingsRow as never);

    const result = await getSettings("u1");

    expect(mockedRepo.upsertSettings).toHaveBeenCalledWith("u1", {});
    expect(result).toEqual({
      missionReminder: true,
      missionReminderTime: "09:00",
      communityApproved: true,
      reportReady: true,
      marketing: false,
    });
  });

  it("설정이 없는 사용자가 PATCH해도 404 대신 upsert로 처리한다", async () => {
    mockedRepo.upsertSettings.mockResolvedValue(settingsRow as never);

    await updateSettingsService("u1", { marketing: true });

    expect(mockedRepo.upsertSettings).toHaveBeenCalledWith("u1", { marketing: true });
  });
});
