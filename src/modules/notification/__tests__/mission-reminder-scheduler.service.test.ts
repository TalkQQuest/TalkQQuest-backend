jest.mock("node-cron", () => ({ schedule: jest.fn() }));
jest.mock("../repositories/notification.repository");
jest.mock("../services/notification.service", () => ({ notifyUser: jest.fn() }));
jest.mock("../../../config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import cron from "node-cron";
import { logger } from "../../../config/logger";
import * as notificationRepository from "../repositories/notification.repository";
import { notifyUser } from "../services/notification.service";
import { startMissionReminderScheduler } from "../services/mission-reminder-scheduler.service";

const mockedCron = jest.mocked(cron);
const mockedLogger = jest.mocked(logger);
const mockedRepo = jest.mocked(notificationRepository);
const mockedNotifyUser = jest.mocked(notifyUser);

// cron.schedule에 넘긴 콜백을 꺼내 직접 실행하기 위한 헬퍼. noOverlap이 실행 상태를 추적할 수
// 있으려면 콜백이 Promise를 반환해야 하므로, 그 반환값까지 그대로 기다린다.
const runScheduledJob = async (): Promise<void> => {
  startMissionReminderScheduler();
  const job = mockedCron.schedule.mock.calls[0][1] as () => Promise<void>;
  await job();
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
      expect.objectContaining({ timezone: "Asia/Seoul", noOverlap: true })
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

  // 회귀 테스트: 대상 유저 조회 자체가 실패해도(DB 일시 오류 등) outer catch가 흡수하고
  // 조용히 끝나야 한다 — unhandled rejection으로 다음 cron tick을 막으면 안 된다.
  it("대상 유저 조회가 실패해도 예외를 던지지 않고 경고 로그만 남긴다", async () => {
    const queryError = new Error("db down");
    mockedRepo.findUsersForMissionReminder.mockRejectedValue(queryError);

    await expect(runScheduledJob()).resolves.toBeUndefined();

    expect(mockedNotifyUser).not.toHaveBeenCalled();
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: queryError }),
      "미션 리마인드 스케줄러 실행 중 예기치 못한 오류"
    );
  });
});
