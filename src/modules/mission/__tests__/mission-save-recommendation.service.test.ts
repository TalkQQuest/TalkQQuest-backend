import { RecommendationLogNotFoundError } from "../errors/mission.error";
import * as repository from "../repositories/mission.repository";
import { saveRecommendedMission } from "../services/mission.service";

// 이 파일은 saveRecommendedMission(POST /missions/from-recommendation)만 다룬다.
// 그 외 mission.service 함수(getMissions 등)는 팀원 구현이라 별도로 다루지 않는다.
jest.mock("../repositories/mission.repository");
const mockedRepo = jest.mocked(repository);

const llmRecommendedMission = (overrides: Record<string, unknown> = {}) => ({
  missionId: null, // llm 추천은 아직 미저장
  title: "카페에서 음료 추천 물어보기",
  description: "설명",
  difficulty: 2,
  estimatedMinutes: 10,
  rewardXp: 20,
  category: "짧은 대화",
  reason: "이유",
  expectedEffect: "효과",
  preparationTip: "메뉴판을 미리 살펴보면 편해요.",
  caution: "점원이 바빠 보이면 짧게 물어보세요.",
  source: "llm",
  setupGuideline: {
    defaults: {
      environment: "daily_place",
      partnerRole: "other",
      intimacyLevel: 2,
      formalityLevel: 4,
      partnerGender: "female",
      partnerAgeGroup: "twenties",
    },
    disabled: {
      environment: [],
      partnerRole: [],
      intimacyLevel: [],
      formalityLevel: [],
      partnerGender: [],
      partnerAgeGroup: [],
    },
    note: null,
    recommendedTopics: [],
    tags: ["첫 만남"],
  },
  recommendationLogId: "log1",
  ...overrides,
});

const buildLog = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "log1",
    user_id: "u1",
    created_mission_id: null,
    recommended_mission: llmRecommendedMission(),
    ...overrides,
  }) as never;

beforeEach(() => {
  jest.clearAllMocks();
  mockedRepo.findUserPersonalityType.mockResolvedValue("introvert");
  // #245 — 기본값은 "재사용할 미션 없음"(새로 만든다). 재사용 테스트에서만 덮어쓴다.
  mockedRepo.findMissionByTitleForReuse.mockResolvedValue(null);
});

describe("saveRecommendedMission", () => {
  it("로그가 없거나 다른 사용자 것이면 RecommendationLogNotFoundError를 던진다", async () => {
    mockedRepo.findRecommendationLogByIdAndUser.mockResolvedValue(null as never);

    await expect(saveRecommendedMission("u1", "log1")).rejects.toBeInstanceOf(
      RecommendationLogNotFoundError
    );
    expect(mockedRepo.createMissionFromRecommendation).not.toHaveBeenCalled();
  });

  it("이미 저장된 적 있으면(created_mission_id 존재) 새로 만들지 않고 그 id를 돌려준다", async () => {
    mockedRepo.findRecommendationLogByIdAndUser.mockResolvedValue(
      buildLog({ created_mission_id: "m-existing" })
    );

    const result = await saveRecommendedMission("u1", "log1");

    expect(result).toEqual({ missionId: "m-existing" });
    expect(mockedRepo.createMissionFromRecommendation).not.toHaveBeenCalled();
  });

  it("template 추천(missionId 있음)은 새로 만들지 않고 그 id를 백링크만 남긴다", async () => {
    mockedRepo.findRecommendationLogByIdAndUser.mockResolvedValue(
      buildLog({
        recommended_mission: llmRecommendedMission({ missionId: "m-template", source: "template" }),
      })
    );

    const result = await saveRecommendedMission("u1", "log1");

    expect(result).toEqual({ missionId: "m-template" });
    expect(mockedRepo.createMissionForRecommendationLog).not.toHaveBeenCalled();
    expect(mockedRepo.markRecommendationLogMissionCreated).toHaveBeenCalledWith("log1", "m-template");
  });

  it("llm/fallback 추천(missionId=null)은 새 Missions 행을 만들고 백링크한다", async () => {
    mockedRepo.findRecommendationLogByIdAndUser.mockResolvedValue(buildLog());
    mockedRepo.createMissionForRecommendationLog.mockResolvedValue("m-new");

    const result = await saveRecommendedMission("u1", "log1");

    // 생성과 백링크는 한 트랜잭션에서 처리된다 — 병렬 저장이 미션을 두 번 만들지 않도록.
    expect(mockedRepo.createMissionForRecommendationLog).toHaveBeenCalledWith("log1", {
      title: "카페에서 음료 추천 물어보기",
      description: "설명",
      difficulty: 2,
      estimatedMinutes: 10,
      rewardXp: 20,
      category: "짧은 대화",
      setupGuideline: llmRecommendedMission().setupGuideline,
      preparationTip: llmRecommendedMission().preparationTip,
      caution: llmRecommendedMission().caution,
      // 유사 성향 필터가 쓸 수 있도록 생성자와 그 시점의 성향을 함께 남긴다.
      createdByUserId: "u1",
      creatorPersonalityType: "introvert",
    });
    expect(result).toEqual({ missionId: "m-new" });
  });

  it("recommended_mission JSON 형식이 깨져 있으면 RecommendationLogNotFoundError를 던진다", async () => {
    mockedRepo.findRecommendationLogByIdAndUser.mockResolvedValue(
      buildLog({ recommended_mission: { unexpected: "shape" } })
    );

    await expect(saveRecommendedMission("u1", "log1")).rejects.toBeInstanceOf(
      RecommendationLogNotFoundError
    );
    expect(mockedRepo.createMissionFromRecommendation).not.toHaveBeenCalled();
  });

  it("recommended_mission이 null이면 RecommendationLogNotFoundError를 던진다", async () => {
    mockedRepo.findRecommendationLogByIdAndUser.mockResolvedValue(
      buildLog({ recommended_mission: null })
    );

    await expect(saveRecommendedMission("u1", "log1")).rejects.toBeInstanceOf(
      RecommendationLogNotFoundError
    );
  });

  // #245 — 같은 제목·같은 성향의 미션이 이미 있으면 새로 만들지 않고 재사용한다.
  it("같은 제목의 AI 미션이 이미 있으면 새로 만들지 않고 재사용해 백링크만 남긴다", async () => {
    mockedRepo.findRecommendationLogByIdAndUser.mockResolvedValue(buildLog());
    mockedRepo.findMissionByTitleForReuse.mockResolvedValue({ id: "m-reused" } as never);

    const result = await saveRecommendedMission("u1", "log1");

    expect(mockedRepo.findMissionByTitleForReuse).toHaveBeenCalledWith(
      "카페에서 음료 추천 물어보기",
      "introvert"
    );
    expect(mockedRepo.createMissionForRecommendationLog).not.toHaveBeenCalled();
    expect(mockedRepo.markRecommendationLogMissionCreated).toHaveBeenCalledWith("log1", "m-reused");
    expect(result).toEqual({ missionId: "m-reused" });
  });
});
