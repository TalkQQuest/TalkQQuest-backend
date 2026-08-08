import { MissionSetupDisabledCombinationError, MissionNotFoundError } from "../errors/mission.error";
import * as repository from "../repositories/mission.repository";
import { createMissionSetup, getMissionDetail } from "../services/mission.service";

// 이 파일은 #152 — 미션 준비 정보(Mission_Setups) 저장 API와, 미션 조회 응답의
// setupGuideline 필드 처리만 다룬다.
jest.mock("../repositories/mission.repository");

const mockedRepo = jest.mocked(repository);

const guideline = (overrides: Record<string, unknown> = {}) => ({
  defaults: {
    environment: "community",
    partnerRole: "other",
    intimacyLevel: 2,
    formalityLevel: 4,
    partnerGender: "female",
    partnerAgeGroup: "twenties",
  },
  disabled: {
    environment: [],
    partnerRole: [],
    intimacyLevel: [4, 5],
    formalityLevel: [1],
    partnerGender: [],
    partnerAgeGroup: [],
  },
  note: "처음 만나는 상황이라 친한 사이·반말 설정은 선택할 수 없어요.",
  recommendedTopics: ["여기 자주 오는지 물어보기"],
  tags: ["첫 만남"],
  ...overrides,
});

const requestBody = (overrides: Record<string, unknown> = {}) => ({
  environment: "community" as const,
  partnerRole: "other" as const,
  partnerGender: "female" as const,
  partnerAgeGroup: "twenties" as const,
  intimacyLevel: 2,
  formalityLevel: 4,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockedRepo.findUserPersonalityType.mockResolvedValue(null);
});

describe("createMissionSetup", () => {
  it("존재하지 않거나 열람 범위 밖의 미션이면 거부한다", async () => {
    mockedRepo.findVisibleMissionById.mockResolvedValue(null);

    await expect(createMissionSetup("u1", "m1", requestBody())).rejects.toBeInstanceOf(
      MissionNotFoundError
    );
    expect(mockedRepo.createMissionSetup).not.toHaveBeenCalled();
  });

  it("가이드라인에 걸린 조합을 요청하면 400으로 거부한다", async () => {
    mockedRepo.findVisibleMissionById.mockResolvedValue({
      id: "m1",
      setup_guideline: guideline(),
    } as never);

    // formalityLevel=1은 disabled.formalityLevel에 들어있다.
    await expect(
      createMissionSetup("u1", "m1", requestBody({ formalityLevel: 1 }))
    ).rejects.toBeInstanceOf(MissionSetupDisabledCombinationError);
    expect(mockedRepo.createMissionSetup).not.toHaveBeenCalled();
  });

  it("가이드라인이 없는 미션(구버전·생성 실패)은 제약 없이 저장한다", async () => {
    mockedRepo.findVisibleMissionById.mockResolvedValue({
      id: "m1",
      setup_guideline: null,
    } as never);
    mockedRepo.createMissionSetup.mockResolvedValue({
      id: "setup1",
      created_at: new Date("2026-08-08T00:00:00Z"),
    } as never);

    const result = await createMissionSetup("u1", "m1", requestBody({ formalityLevel: 1 }));

    expect(result).toEqual({ missionSetupId: "setup1", createdAt: "2026-08-08T00:00:00.000Z" });
  });

  it("허용된 조합이면 저장하고, 미션의 setup_guideline은 절대 갱신하지 않는다", async () => {
    mockedRepo.findVisibleMissionById.mockResolvedValue({
      id: "m1",
      setup_guideline: guideline(),
    } as never);
    mockedRepo.createMissionSetup.mockResolvedValue({
      id: "setup2",
      created_at: new Date("2026-08-08T00:00:00Z"),
    } as never);

    const result = await createMissionSetup("u1", "m1", requestBody());

    expect(result.missionSetupId).toBe("setup2");
    expect(mockedRepo.createMissionSetup).toHaveBeenCalledWith("u1", "m1", requestBody());
    // 이 서비스가 미션 자체를 갱신하는 어떤 repository 함수도 호출하지 않는다 —
    // Mission_Setups는 개인 설정이고 Missions.setup_guideline은 여러 사용자가 공유하는
    // 정적 가이드라인이라, 여기서 덮어쓰면 다른 사용자의 미션 창까지 물든다.
    expect(mockedRepo.createMissionSetup).toHaveBeenCalledTimes(1);
  });
});

describe("getMissionDetail — setupGuideline", () => {
  it("정상적인 가이드라인은 그대로 응답에 포함된다", async () => {
    mockedRepo.findVisibleMissionById.mockResolvedValue({
      id: "m1",
      title: "처음 만난 사람에게 자기소개하기",
      category: "짧은 대화",
      difficulty: 2,
      estimated_minutes: 10,
      reward_xp: 20,
      description: "설명",
      preparation_tip: null,
      caution: null,
      setup_guideline: guideline(),
    } as never);
    mockedRepo.findSavedMission.mockResolvedValue(null);

    const result = await getMissionDetail("u1", "m1");

    expect(result.setupGuideline).toEqual(guideline());
  });

  it("setup_guideline이 null이면 setupGuideline도 null이다", async () => {
    mockedRepo.findVisibleMissionById.mockResolvedValue({
      id: "m1",
      title: "t",
      category: "c",
      difficulty: 1,
      estimated_minutes: 5,
      reward_xp: 10,
      description: "d",
      preparation_tip: null,
      caution: null,
      setup_guideline: null,
    } as never);
    mockedRepo.findSavedMission.mockResolvedValue(null);

    const result = await getMissionDetail("u1", "m1");

    expect(result.setupGuideline).toBeNull();
  });

  it("setup_guideline 형식이 깨져 있으면 미션 조회는 성공하되 setupGuideline은 null이다", async () => {
    mockedRepo.findVisibleMissionById.mockResolvedValue({
      id: "m1",
      title: "t",
      category: "c",
      difficulty: 1,
      estimated_minutes: 5,
      reward_xp: 10,
      description: "d",
      preparation_tip: null,
      caution: null,
      setup_guideline: { unexpected: "shape" },
    } as never);
    mockedRepo.findSavedMission.mockResolvedValue(null);

    const result = await getMissionDetail("u1", "m1");

    expect(result.setupGuideline).toBeNull();
    expect(result.id).toBe("m1");
  });
});
