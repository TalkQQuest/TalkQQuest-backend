jest.mock("../../../config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../repositories/home.repository");
jest.mock("../../mission/services/mission.service");
jest.mock("../../report/services/growth.service");
jest.mock("../../notification/services/notification.service");

import * as homeRepository from "../repositories/home.repository";
import * as missionService from "../../mission/services/mission.service";
import * as growthService from "../../report/services/growth.service";
import * as notificationService from "../../notification/services/notification.service";
import { getHomeSummary } from "../services/home.service";
import { MissionProfileNotFoundError } from "../../mission/errors/mission.error";
import { NotFoundError } from "../../../shared/errors/common.error";

const mockedRepo = jest.mocked(homeRepository);
const mockedMission = jest.mocked(missionService);
const mockedGrowth = jest.mocked(growthService);
const mockedNotification = jest.mocked(notificationService);

const todayMission = {
  missionId: "m1",
  date: "2026-08-03",
  title: "카페에서 음료 추천 물어보기",
  description: "설명",
  category: "짧은 대화",
  difficulty: "보통" as const,
  estimatedMinutes: 10,
  rewardXp: 20,
  isSaved: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedRepo.findHomeSummaryData.mockResolvedValue({
    profile: { nickname: "유경", level: 2, xp: 40 },
    archiveCount: 3,
  } as never);
  mockedRepo.hasCompletedMissionSince.mockResolvedValue(false);
  mockedMission.getTodayMission.mockResolvedValue(todayMission as never);
  mockedGrowth.getGrowthMetricTotals.mockResolvedValue({
    kindnessTotal: 0,
    initiativeTotal: 0,
    empathyTotal: 0,
    questionLinkTotal: 0,
  } as never);
  mockedNotification.getLatestUnreadReportId.mockResolvedValue(null);
});

describe("getHomeSummary", () => {
  it("프로필과 오늘의 미션 카드를 함께 반환한다", async () => {
    const result = await getHomeSummary("u1");

    expect(result.nickname).toBe("유경");
    expect(result.todayMission?.id).toBe("m1");
    expect(result.todayMission?.difficulty).toBe("보통");
  });

  it("프로필이 없으면 404를 던진다", async () => {
    mockedRepo.findHomeSummaryData.mockResolvedValue({
      profile: null,
      archiveCount: 0,
    } as never);

    await expect(getHomeSummary("u1")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("온보딩 미완료면 카드만 비우고 홈은 정상 반환한다", async () => {
    mockedMission.getTodayMission.mockRejectedValue(new MissionProfileNotFoundError());

    const result = await getHomeSummary("u1");

    expect(result.todayMission).toBeNull();
    expect(result.nickname).toBe("유경");
  });

  it("추천 도중 DB 오류가 나도 홈 전체를 깨뜨리지 않는다", async () => {
    // 카드는 홈의 한 조각일 뿐인데 여기서 던진 오류가 올라가면
    // 닉네임·레벨·경험치까지 함께 사라져 홈이 열리지 않는다.
    mockedMission.getTodayMission.mockRejectedValue(new Error("db down"));

    const result = await getHomeSummary("u1");

    expect(result.todayMission).toBeNull();
    expect(result.nickname).toBe("유경");
    expect(result.archiveCount).toBe(3);
  });

  it("완료 여부 조회가 실패해도 홈은 정상 반환한다", async () => {
    mockedRepo.hasCompletedMissionSince.mockRejectedValue(new Error("db down"));

    const result = await getHomeSummary("u1");

    expect(result.todayMission).toBeNull();
    expect(result.nickname).toBe("유경");
  });

  it("완료 여부를 추천이 속한 날짜 기준으로 조회한다", async () => {
    // 여기서 오늘 날짜를 다시 계산하면, KST 자정을 걸친 요청에서 추천은 어제 것인데
    // 완료 여부만 오늘 기준으로 조회돼 어제 완료한 미션이 미완료로 보인다.
    await getHomeSummary("u1");

    expect(mockedRepo.hasCompletedMissionSince).toHaveBeenCalledWith(
      "u1",
      "m1",
      new Date("2026-08-03T00:00:00+09:00")
    );
  });
});

// #193 — 안 읽은 주간 비교 리포트 알림이 있으면 홈 요약에서 바로 그 리포트 id를 알 수 있어야
// "리포트가 도착했어요" 모달을 띄우고 곧장 상세로 보낼 수 있다.
describe("getHomeSummary — newWeeklyCompareReport(#193)", () => {
  it("안 읽은 주간 비교 리포트 알림이 있으면 available: true와 reportId를 반환한다", async () => {
    mockedNotification.getLatestUnreadReportId.mockResolvedValue("w1");

    const result = await getHomeSummary("u1");

    expect(result.newWeeklyCompareReport).toEqual({ available: true, reportId: "w1" });
    // #223 — 주간 비교 리포트 알림은 이제 report_ready가 아니라 전용 type을 쓴다.
    expect(mockedNotification.getLatestUnreadReportId).toHaveBeenCalledWith(
      "u1",
      "weekly_compare_ready",
      "weekly_compare"
    );
  });

  it("안 읽은 리포트 알림이 없으면 available: false를 반환한다", async () => {
    mockedNotification.getLatestUnreadReportId.mockResolvedValue(null);

    const result = await getHomeSummary("u1");

    expect(result.newWeeklyCompareReport).toEqual({ available: false, reportId: null });
  });

  it("조회가 실패해도 홈 전체를 깨뜨리지 않고 available: false로 흡수한다", async () => {
    mockedNotification.getLatestUnreadReportId.mockRejectedValue(new Error("db down"));

    const result = await getHomeSummary("u1");

    expect(result.newWeeklyCompareReport).toEqual({ available: false, reportId: null });
    expect(result.nickname).toBe("유경");
  });
});
