jest.mock("node-cron", () => ({ schedule: jest.fn() }));
jest.mock("../repositories/notification.repository");
jest.mock("../services/notification.service", () => ({ notifyUser: jest.fn() }));
jest.mock("../../../config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import cron from "node-cron";
import * as notificationRepository from "../repositories/notification.repository";
import { notifyUser } from "../services/notification.service";
import { startMissionReminderScheduler } from "../services/mission-reminder-scheduler.service";

const mockedCron = jest.mocked(cron);
const mockedRepo = jest.mocked(notificationRepository);
const mockedNotifyUser = jest.mocked(notifyUser);

// cron.schedule에 넘긴 콜백을 꺼내 직접 실행하기 위한 헬퍼.
const runScheduledJob = async (): Promise<void> => {
  startMissionReminderScheduler();
  const job = mockedCron.schedule.mock.calls[0][1] as () => void;
  job();
  await new Promise((resolve) => setImmediate(resolve));
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("startMissionReminderScheduler", () => {
  it("매 분 실행되도록 Asia/Seoul 타임존으로 cron을 등록한다", () => {
    startMissionReminderScheduler();

    expect(mockedCron.schedule).toHaveBeenCalledWith(
      "* * * * *",
      expect.any(Function),
      expect.objectContaining({ timezone: "Asia/Seoul" })
    );
  });

  it("해당 시각에 일치하는 유저가 없으면 알림을 보내지 않는다", async () => {
    mockedRepo.findUsersForMissionReminder.mockResolvedValue([]);

    await runScheduledJob();

    expect(mockedNotifyUser).not.toHaveBeenCalled();
  });

  it("일치하는 유저 전원에게 미션 리마인드 알림을 보낸다", async () => {
    mockedRepo.findUsersForMissionReminder.mockResolvedValue([
      { user_id: "u1" },
      { user_id: "u2" },
    ] as never);
    mockedNotifyUser.mockResolvedValue(undefined);

    await runScheduledJob();

    expect(mockedNotifyUser).toHaveBeenCalledTimes(2);
    expect(mockedNotifyUser).toHaveBeenCalledWith(
      "u1",
      "mission_reminder",
      expect.any(String),
      expect.any(String)
    );
  });

  it("한 유저의 발송이 실패해도 나머지 유저 발송은 계속된다", async () => {
    mockedRepo.findUsersForMissionReminder.mockResolvedValue([
      { user_id: "u1" },
      { user_id: "u2" },
    ] as never);
    mockedNotifyUser.mockRejectedValueOnce(new Error("db down")).mockResolvedValueOnce(undefined);

    await runScheduledJob();

    expect(mockedNotifyUser).toHaveBeenCalledTimes(2);
  });
});
