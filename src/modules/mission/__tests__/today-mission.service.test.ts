import {
  InvalidMissionDateError,
  MissionRefreshLimitExceededError,
} from "../errors/mission.error";
import * as repository from "../repositories/mission.repository";
import * as recommendationService from "../services/recommendation.service";
import { getTodayMission } from "../services/mission.service";
import { MISSION_REFRESH_LIMIT } from "../dtos/mission.constants";
import { todayInKst } from "../../../shared/utils/date";

// 이 파일은 GET /missions/today(getTodayMission)의 일일 캐시·새로고침 제한만 다룬다.
jest.mock("../repositories/mission.repository");
jest.mock("../services/recommendation.service");

const mockedRepo = jest.mocked(repository);
const mockedRecommend = jest.mocked(recommendationService);

const TODAY = todayInKst();

const recommended = (overrides: Record<string, unknown> = {}) => ({
  missionId: null,
  title: "카페에서 음료 추천 물어보기",
  description: "설명",
  difficulty: 2,
  estimatedMinutes: 10,
  rewardXp: 20,
  category: "짧은 대화",
  reason: "이유",
  expectedEffect: "효과",
  source: "llm" as const,
  recommendationLogId: "log1",
  ...overrides,
});

// Recommendation_Logs 한 행. recommended_mission에는 추천 스냅샷 JSON이 들어간다.
const buildLog = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "log1",
    user_id: "u1",
    created_mission_id: "m-existing",
    recommended_mission: recommended({ missionId: null }),
    ...overrides,
  }) as never;

beforeEach(() => {
  jest.clearAllMocks();
  mockedRepo.findUserPersonalityType.mockResolvedValue("introvert");
  mockedRepo.findSavedMission.mockResolvedValue(null as never);
  mockedRepo.findLatestRecommendationLogByDate.mockResolvedValue(null as never);
  mockedRepo.countRecommendationLogsByDate.mockResolvedValue(0);
  mockedRepo.createMissionFromRecommendation.mockResolvedValue({ id: "m-new" } as never);
  mockedRepo.markRecommendationLogMissionCreated.mockResolvedValue({} as never);
  mockedRecommend.recommendMission.mockResolvedValue(recommended());
});

describe("getTodayMission — 일일 캐시", () => {
  it("오늘 추천이 없으면 새로 뽑고 실제 Missions 행까지 만든다", async () => {
    const result = await getTodayMission("u1", { date: TODAY });

    expect(mockedRecommend.recommendMission).toHaveBeenCalledTimes(1);
    expect(mockedRepo.createMissionFromRecommendation).toHaveBeenCalledTimes(1);
    // 추천 시점에 저장하므로 missionId가 null로 나가지 않는다.
    expect(result.missionId).toBe("m-new");
    expect(result.isNew).toBe(true);
  });

  it("생성한 미션을 추천 로그에 백링크해 중복 생성을 막는다", async () => {
    await getTodayMission("u1", { date: TODAY });

    expect(mockedRepo.markRecommendationLogMissionCreated).toHaveBeenCalledWith("log1", "m-new");
  });

  it("오늘 추천이 이미 있으면 LLM을 다시 부르지 않고 그대로 돌려준다", async () => {
    mockedRepo.findLatestRecommendationLogByDate.mockResolvedValue(buildLog());
    mockedRepo.countRecommendationLogsByDate.mockResolvedValue(1);

    const result = await getTodayMission("u1", { date: TODAY });

    expect(mockedRecommend.recommendMission).not.toHaveBeenCalled();
    expect(mockedRepo.createMissionFromRecommendation).not.toHaveBeenCalled();
    expect(result.missionId).toBe("m-existing");
    expect(result.isNew).toBe(false);
  });

  it("template 추천은 이미 실제 미션이라 새로 만들지 않는다", async () => {
    mockedRecommend.recommendMission.mockResolvedValue(
      recommended({ missionId: "m-template", source: "template" })
    );

    const result = await getTodayMission("u1", { date: TODAY });

    expect(mockedRepo.createMissionFromRecommendation).not.toHaveBeenCalled();
    expect(result.missionId).toBe("m-template");
  });

  it("캐시된 로그의 JSON이 깨져 있으면 캐시를 포기하고 새로 뽑는다", async () => {
    mockedRepo.findLatestRecommendationLogByDate.mockResolvedValue(
      buildLog({ recommended_mission: { unexpected: "shape" } })
    );
    mockedRepo.countRecommendationLogsByDate.mockResolvedValue(1);

    const result = await getTodayMission("u1", { date: TODAY });

    expect(mockedRecommend.recommendMission).toHaveBeenCalledTimes(1);
    expect(result.isNew).toBe(true);
  });
});

describe("getTodayMission — 새로고침 제한", () => {
  it("refresh=true면 오늘 추천이 있어도 새로 뽑는다", async () => {
    mockedRepo.findLatestRecommendationLogByDate.mockResolvedValue(buildLog());
    mockedRepo.countRecommendationLogsByDate.mockResolvedValue(1);

    const result = await getTodayMission("u1", { date: TODAY, refresh: true });

    expect(mockedRecommend.recommendMission).toHaveBeenCalledTimes(1);
    expect(result.isNew).toBe(true);
    expect(result.refreshCount).toBe(1); // 로그 2건 = 새로고침 1회
  });

  it("그날 첫 생성은 새로고침으로 세지 않는다", async () => {
    const result = await getTodayMission("u1", { date: TODAY });

    expect(result.refreshCount).toBe(0);
    expect(result.remainingRefreshes).toBe(MISSION_REFRESH_LIMIT);
  });

  it("새로고침 횟수를 모두 쓰면 429를 던지고 LLM을 부르지 않는다", async () => {
    mockedRepo.findLatestRecommendationLogByDate.mockResolvedValue(buildLog());
    // 첫 생성 1건 + 새로고침 3건 = 4건이면 한도 소진
    mockedRepo.countRecommendationLogsByDate.mockResolvedValue(1 + MISSION_REFRESH_LIMIT);

    await expect(getTodayMission("u1", { date: TODAY, refresh: true })).rejects.toBeInstanceOf(
      MissionRefreshLimitExceededError
    );
    expect(mockedRecommend.recommendMission).not.toHaveBeenCalled();
  });

  it("한도를 다 썼어도 refresh 없이 조회하면 캐시된 추천을 정상 반환한다", async () => {
    mockedRepo.findLatestRecommendationLogByDate.mockResolvedValue(buildLog());
    mockedRepo.countRecommendationLogsByDate.mockResolvedValue(1 + MISSION_REFRESH_LIMIT);

    const result = await getTodayMission("u1", { date: TODAY });

    expect(result.missionId).toBe("m-existing");
    expect(result.remainingRefreshes).toBe(0);
  });
});

describe("getTodayMission — 날짜 검증", () => {
  it("date를 생략하면 서버(KST) 기준 오늘을 쓴다", async () => {
    const result = await getTodayMission("u1");

    expect(result.date).toBe(TODAY);
  });

  it("서버 기준 오늘과 하루 넘게 차이 나는 날짜는 거부한다(새로고침 제한 우회 방지)", async () => {
    await expect(getTodayMission("u1", { date: "2020-01-01" })).rejects.toBeInstanceOf(
      InvalidMissionDateError
    );
    expect(mockedRecommend.recommendMission).not.toHaveBeenCalled();
  });
});
