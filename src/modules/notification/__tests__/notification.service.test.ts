jest.mock("../repositories/notification.repository");
jest.mock("../services/push.service");
jest.mock("../../../config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import * as notificationRepository from "../repositories/notification.repository";
import * as pushService from "../services/push.service";
import { notifyUser, getNotifications, getLatestUnreadReportId } from "../services/notification.service";

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
