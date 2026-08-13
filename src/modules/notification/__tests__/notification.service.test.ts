jest.mock("../repositories/notification.repository");
jest.mock("../services/push.service");
jest.mock("../../../config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import * as notificationRepository from "../repositories/notification.repository";
import * as pushService from "../services/push.service";
import {
  notifyUser,
  getNotifications,
  getLatestUnreadReportId,
  deleteMyNotification,
  deleteAllMyNotifications,
  getNotificationSettings,
  updateNotificationSettingsService,
} from "../services/notification.service";
import { NotFoundError } from "../../../shared/errors/common.error";

const mockedRepo = jest.mocked(notificationRepository);
const mockedPush = jest.mocked(pushService);

beforeEach(() => {
  jest.clearAllMocks();
});

describe("notifyUser", () => {
  it("weekly_compare_ready는 인앱 알림을 만들고 같은 내용으로 푸시를 발송한다", async () => {
    mockedRepo.createNotification.mockResolvedValue({} as never);
    mockedPush.sendPushToUser.mockResolvedValue(undefined);

    await notifyUser("u1", "weekly_compare_ready", "제목", "본문", "report-1", "weekly_compare");

    expect(mockedRepo.createNotification).toHaveBeenCalledWith(
      "u1",
      "weekly_compare_ready",
      "제목",
      "본문",
      "report-1",
      "weekly_compare"
    );
    expect(mockedPush.sendPushToUser).toHaveBeenCalledWith("u1", {
      title: "제목",
      body: "본문",
      data: {
        type: "weekly_compare_ready",
        referenceId: "report-1",
        referenceType: "weekly_compare",
      },
    });
  });

  it("mission_completed는 인앱 알림만 만들고 푸시는 발송하지 않는다", async () => {
    mockedRepo.createNotification.mockResolvedValue({} as never);

    await notifyUser("u1", "mission_completed", "미션 완료", "축하합니다", "record-1", "mission_record");

    expect(mockedRepo.createNotification).toHaveBeenCalledWith(
      "u1",
      "mission_completed",
      "미션 완료",
      "축하합니다",
      "record-1",
      "mission_record"
    );
    expect(mockedPush.sendPushToUser).not.toHaveBeenCalled();
  });

  it("weekly_compare_ready 푸시 발송이 실패해도 예외를 던지지 않는다(인앱 알림은 이미 생성됨)", async () => {
    mockedRepo.createNotification.mockResolvedValue({} as never);
    mockedPush.sendPushToUser.mockRejectedValue(new Error("fcm down"));

    await expect(notifyUser("u1", "weekly_compare_ready", "제목")).resolves.toBeUndefined();
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

// #193 — 알림을 눌러도 대상 리포트를 특정할 수 없던 문제. referenceId/referenceType을
// 응답에 그대로 노출한다(DB엔 이미 저장돼 있던 값).
describe("getNotifications — referenceId/referenceType 노출(#193)", () => {
  it("알림 목록에 referenceId/referenceType을 포함한다", async () => {
    mockedRepo.findNotificationsByUserId.mockResolvedValue([
      {
        id: "n1",
        type: "report_ready",
        title: "주간 비교 리포트가 도착했어요!",
        body: null,
        is_read: false,
        reference_id: "w1",
        reference_type: "weekly_compare",
        created_at: new Date("2026-08-08T00:00:00Z"),
      },
    ] as never);

    const result = await getNotifications("u1");

    expect(result.notifications[0]).toMatchObject({ referenceId: "w1", referenceType: "weekly_compare" });
  });

  it("참조 대상이 없는 알림은 referenceId/referenceType이 null이다", async () => {
    mockedRepo.findNotificationsByUserId.mockResolvedValue([
      {
        id: "n1",
        type: "mission_reminder",
        title: "오늘의 미션을 시작해보세요!",
        body: null,
        is_read: false,
        reference_id: null,
        reference_type: null,
        created_at: new Date("2026-08-08T00:00:00Z"),
      },
    ] as never);

    const result = await getNotifications("u1");

    expect(result.notifications[0]).toMatchObject({ referenceId: null, referenceType: null });
  });
});

// #193 — 홈 요약이 "새 리포트 도착" 모달을 띄울지 판단할 때 쓰는 조회.
describe("getLatestUnreadReportId(#193)", () => {
  it("안 읽은 알림이 있으면 그 reference_id를 반환한다", async () => {
    mockedRepo.findLatestUnreadNotificationByReferenceType.mockResolvedValue({
      reference_id: "w1",
    } as never);

    const result = await getLatestUnreadReportId("u1", "report_ready", "weekly_compare");

    expect(result).toBe("w1");
    expect(mockedRepo.findLatestUnreadNotificationByReferenceType).toHaveBeenCalledWith(
      "u1",
      "report_ready",
      "weekly_compare"
    );
  });

  it("안 읽은 알림이 없으면 null을 반환한다", async () => {
    mockedRepo.findLatestUnreadNotificationByReferenceType.mockResolvedValue(null as never);

    const result = await getLatestUnreadReportId("u1", "report_ready", "weekly_compare");

    expect(result).toBeNull();
  });

  // 회귀 테스트(코드래빗 리뷰): reference_type만 보고 type을 안 걸러내면, weekly_compare를
  // 참조하는 report_ready 외 다른 종류의 알림도 "새 리포트 도착"으로 잘못 인식할 수 있다.
  // repository 함수 호출에 type을 함께 넘기는지로 이 필터링이 실제로 적용됨을 검증한다.
  it("type과 referenceType을 모두 repository에 함께 넘긴다", async () => {
    mockedRepo.findLatestUnreadNotificationByReferenceType.mockResolvedValue(null as never);

    await getLatestUnreadReportId("u1", "report_ready", "weekly_compare");

    expect(mockedRepo.findLatestUnreadNotificationByReferenceType).toHaveBeenCalledWith(
      "u1",
      "report_ready",
      "weekly_compare"
    );
  });
});

// #215 — 회원가입 시점에 Notification_Settings 행이 생성되지 않아 조회/수정이 항상 404였다.
// 이제 upsert로 처리해 없으면 즉시 생성한다(기존 가입자도 첫 호출에서 자동으로 해결).
describe("알림 설정 조회/수정 (#215)", () => {
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
    mockedRepo.upsertNotificationSettings.mockResolvedValue(settingsRow as never);

    const result = await getNotificationSettings("u1");

    expect(mockedRepo.upsertNotificationSettings).toHaveBeenCalledWith("u1", {});
    expect(result).toEqual({
      missionReminder: true,
      missionReminderTime: "09:00",
      communityApproved: true,
      reportReady: true,
      marketing: false,
    });
  });

  it("설정이 없는 사용자가 PATCH해도 404 대신 upsert로 처리한다", async () => {
    mockedRepo.upsertNotificationSettings.mockResolvedValue(settingsRow as never);

    await updateNotificationSettingsService("u1", { missionReminder: false });

    expect(mockedRepo.upsertNotificationSettings).toHaveBeenCalledWith("u1", {
      mission_reminder: false,
    });
  });
});
