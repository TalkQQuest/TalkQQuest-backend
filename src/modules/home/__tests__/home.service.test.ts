jest.mock("../../../config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../repositories/home.repository");
jest.mock("../../mission/services/mission.service");

import * as homeRepository from "../repositories/home.repository";
import * as missionService from "../../mission/services/mission.service";
import { getHomeSummary } from "../services/home.service";
import { MissionProfileNotFoundError } from "../../mission/errors/mission.error";
import { NotFoundError } from "../../../shared/errors/common.error";

const mockedRepo = jest.mocked(homeRepository);
const mockedMission = jest.mocked(missionService);

const todayMission = {
  missionId: "m1",
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

  it("실제 미션 행이 없으면 카드를 비운다", async () => {
    // missionId가 없으면 카드에서 대화를 시작할 수 없다.
    mockedMission.getTodayMission.mockResolvedValue({ ...todayMission, missionId: null } as never);

    const result = await getHomeSummary("u1");

    expect(result.todayMission).toBeNull();
  });
});
