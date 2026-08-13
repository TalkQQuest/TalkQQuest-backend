jest.mock("../../../config/database", () => ({
  prisma: { $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn({})) },
}));
jest.mock("../repositories/mission.repository");
jest.mock("../repositories/mission-completion.repository");
jest.mock("../../notification/services/notification.service");
jest.mock("../../badge/services/badge.service");
jest.mock("../../../config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import * as missionRepository from "../repositories/mission.repository";
import * as missionCompletionRepository from "../repositories/mission-completion.repository";
import * as notificationService from "../../notification/services/notification.service";
import * as badgeService from "../../badge/services/badge.service";
import { completeMission } from "../services/mission-completion.service";
import { ValidationError } from "../../../shared/errors/common.error";

const mockedMissionRepo = jest.mocked(missionRepository);
const mockedRepo = jest.mocked(missionCompletionRepository);
const mockedNotification = jest.mocked(notificationService);
const mockedBadge = jest.mocked(badgeService);

const mission = { id: "m1", title: "카페에서 음료 추천 물어보기", reward_xp: 20 };
const sufficientMessages = [
  { role: "guide", content: "어서오세요, 무엇을 도와드릴까요?" },
  { role: "user", content: "오늘 어떤 음료가 인기 있어요?" },
  { role: "user", content: "그럼 그걸로 한 잔 주세요, 감사합니다." },
];
const conversation = {
  id: "c1",
  mission_id: "m1",
  user_id: "u1",
  status: "in_progress",
  messages: sufficientMessages,
};
const requestBody = {
  conversationId: "c1",
  result: "success" as const,
  durationMinutes: 5,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedMissionRepo.findMissionById.mockResolvedValue(mission as never);
  mockedRepo.findConversationByIdAndUser.mockResolvedValue(conversation as never);
  mockedRepo.createMissionRecord.mockResolvedValue({
    id: "record1",
    completed_at: new Date("2026-08-09T00:00:00Z"),
  } as never);
  mockedRepo.markConversationCompleted.mockResolvedValue({} as never);
  mockedRepo.archiveConversationIfMissing.mockResolvedValue(undefined as never);
  mockedRepo.findProfileForUpdate.mockResolvedValue({ level: 1, xp: 0 } as never);
  mockedRepo.createXpHistory.mockResolvedValue({} as never);
  mockedRepo.updateProfileXpAndLevel.mockResolvedValue({} as never);
  mockedBadge.checkAndAwardBadges.mockResolvedValue([]);
  mockedNotification.notifyUser.mockResolvedValue(undefined);
});

describe("completeMission — 알림 생성 실패가 미션 완료 자체를 막지 않는다 (#160 리뷰 대응)", () => {
  it("notifyUser가 성공하면 그대로 결과를 반환한다", async () => {
    const result = await completeMission("u1", "m1", requestBody);

    expect(result.missionRecordId).toBe("record1");
    expect(mockedNotification.notifyUser).toHaveBeenCalledWith(
      "u1",
      "mission_completed",
      expect.any(String),
      expect.stringContaining(mission.title),
      "record1",
      "mission_record"
    );
  });

  // 회귀 테스트: 트랜잭션 커밋(미션 완료·XP 지급) 후에 notifyUser가 실패해도, 이미 커밋된
  // 결과를 그대로 응답해야 한다 — 그러지 않으면 사용자는 미션이 완료됐는데도 에러를 받고,
  // 재시도하면 "이미 종료된 대화" 검증에 막힌다.
  it("notifyUser가 실패해도 completeMission은 정상적으로 결과를 반환한다", async () => {
    mockedNotification.notifyUser.mockRejectedValue(new Error("알림 저장 실패"));

    const result = await completeMission("u1", "m1", requestBody);

    expect(result.missionRecordId).toBe("record1");
    expect(result.status).toBe("completed");
  });
});

describe("completeMission — 사용자 발화 여부에 따른 완료 후처리", () => {
  it("사용자 발화가 없으면 대화만 종료하고 완료 후처리를 모두 건너뛴다", async () => {
    mockedRepo.findConversationByIdAndUser.mockResolvedValue({
      ...conversation,
      messages: [{ role: "guide", content: "어서오세요, 무엇을 도와드릴까요?" }],
    } as never);

    const completion = completeMission("u1", "m1", requestBody);
    await expect(completion).rejects.toMatchObject({
      statusCode: 400,
      errorCode: "VALIDATION_ERROR",
    });
    await expect(completion).rejects.toBeInstanceOf(ValidationError);

    expect(mockedRepo.createMissionRecord).not.toHaveBeenCalled();
    expect(mockedRepo.archiveConversationIfMissing).not.toHaveBeenCalled();
    expect(mockedRepo.createXpHistory).not.toHaveBeenCalled();
    expect(mockedRepo.updateProfileXpAndLevel).not.toHaveBeenCalled();
    expect(mockedBadge.checkAndAwardBadges).not.toHaveBeenCalled();
    expect(mockedNotification.notifyUser).not.toHaveBeenCalled();
    // 대화 종료에 필요한 상태 변경은 그대로 진행된다.
    expect(mockedRepo.markConversationCompleted).toHaveBeenCalledWith("c1", {});
  });

  it("사용자 발화가 한 건이면 기존 완료 후처리를 수행한다", async () => {
    mockedRepo.findConversationByIdAndUser.mockResolvedValue({
      ...conversation,
      messages: [
        { role: "guide", content: "어서오세요, 무엇을 도와드릴까요?" },
        { role: "user", content: "네" },
      ],
    } as never);

    const result = await completeMission("u1", "m1", requestBody);

    expect(result.xpEarned).toBe(mission.reward_xp);
    expect(result.missionRecordId).toBe("record1");
    expect(mockedRepo.createMissionRecord).toHaveBeenCalled();
    expect(mockedRepo.archiveConversationIfMissing).toHaveBeenCalledWith("u1", "c1", {});
    expect(mockedNotification.notifyUser).toHaveBeenCalled();
  });

  it("여러 사용자 발화가 있는 정상 대화도 기존과 동일하게 완료 처리한다", async () => {
    const result = await completeMission("u1", "m1", requestBody);

    expect(result.xpEarned).toBe(mission.reward_xp);
    expect(mockedRepo.archiveConversationIfMissing).toHaveBeenCalledWith("u1", "c1", {});
  });
});
