import { MissionProfileNotFoundError } from "../errors/mission.error";
import * as repository from "../repositories/mission.repository";
import * as llmService from "../services/llm.service";
import {
  assembleUserContext,
  buildRecommendationInput,
  recommendMission,
} from "../services/recommendation.service";

// 1단계는 I/O(레포지토리)에 의존하므로 Prisma 계층을 통째로 mock한다.
jest.mock("../repositories/mission.repository");
// recommendMission의 4단계 LLM 호출이 실제 네트워크를 타지 않도록 mock한다.
jest.mock("../services/llm.service");

const mockedRepo = jest.mocked(repository);
const mockedLlm = jest.mocked(llmService);

// Prisma 반환 형태를 흉내 낸 최소 팩토리 (테스트에 필요한 필드만).
const buildProfile = (overrides: Record<string, unknown> = {}) =>
  ({
    user_id: "u1",
    onboarding_completed: true,
    personality_type: "introvert",
    status_type: "새내기",
    difficult_situations: ["낯선 사람과 대화"],
    interests: ["카페", "산책"],
    purpose: "자신감 향상",
    level: 1,
    ...overrides,
  }) as never;

const buildRecord = (overrides: Record<string, unknown> = {}) =>
  ({
    result: "success",
    created_at: new Date("2026-07-01T00:00:00Z"),
    mission: { id: "m1", title: "미션", category: "cafe", difficulty: 2 },
    ...overrides,
  }) as never;

beforeEach(() => {
  jest.clearAllMocks();
  mockedRepo.findActiveGoalsByUserId.mockResolvedValue([] as never);
  mockedRepo.findRecentMissionRecords.mockResolvedValue([] as never);
  mockedRepo.findTemplateMissionsExcluding.mockResolvedValue([] as never);
  // 기본값: LLM은 실패(null) → 템플릿/폴백 경로. 특정 테스트에서만 성공값으로 덮어쓴다.
  mockedLlm.generateMissionWithLlm.mockResolvedValue(null);
});

describe("assembleUserContext", () => {
  it("프로필이 없으면 MissionProfileNotFoundError를 던진다", async () => {
    mockedRepo.findUserProfileByUserId.mockResolvedValue(null as never);
    await expect(assembleUserContext("u1")).rejects.toBeInstanceOf(MissionProfileNotFoundError);
  });

  it("온보딩 미완료면 MissionProfileNotFoundError를 던진다", async () => {
    mockedRepo.findUserProfileByUserId.mockResolvedValue(
      buildProfile({ onboarding_completed: false })
    );
    await expect(assembleUserContext("u1")).rejects.toBeInstanceOf(MissionProfileNotFoundError);
  });

  it("수행 기록이 없으면 콜드스타트이며 성향 시드 난이도를 쓴다", async () => {
    mockedRepo.findUserProfileByUserId.mockResolvedValue(buildProfile());

    const context = await assembleUserContext("u1");

    expect(context.isColdStart).toBe(true);
    expect(context.baseDifficulty).toBe(1); // introvert 시드
    expect(context.recentMissions).toEqual([]);
  });

  it("기록이 있으면 가장 최근 미션 난이도를 기준 난이도로 쓴다", async () => {
    mockedRepo.findUserProfileByUserId.mockResolvedValue(buildProfile());
    mockedRepo.findRecentMissionRecords.mockResolvedValue([
      buildRecord({ mission: { id: "m9", title: "최근", category: "school", difficulty: 3 } }),
      buildRecord({ mission: { id: "m8", title: "이전", category: "cafe", difficulty: 1 } }),
    ] as never);

    const context = await assembleUserContext("u1");

    expect(context.isColdStart).toBe(false);
    expect(context.baseDifficulty).toBe(3); // 최신 기록 기준
    expect(context.recentMissions[0]).toMatchObject({ missionId: "m9", category: "school" });
  });

  it("Json 관심사/어려운 상황에서 문자열만 안전하게 추출한다", async () => {
    mockedRepo.findUserProfileByUserId.mockResolvedValue(
      buildProfile({ interests: ["카페", 42, null, "산책"], difficult_situations: "잘못된형식" })
    );

    const context = await assembleUserContext("u1");

    expect(context.interests).toEqual(["카페", "산책"]);
    expect(context.difficultSituations).toEqual([]); // 배열이 아니면 빈 배열
  });

  it("목표는 활성 Goals.target과 프로필 purpose를 합쳐 중복 제거한다", async () => {
    mockedRepo.findUserProfileByUserId.mockResolvedValue(buildProfile({ purpose: "자신감 향상" }));
    mockedRepo.findActiveGoalsByUserId.mockResolvedValue([
      { target: "친구 만들기" },
      { target: "자신감 향상" },
    ] as never);

    const context = await assembleUserContext("u1");

    expect(context.goals).toEqual(["친구 만들기", "자신감 향상"]);
  });

  it("purpose가 문자열이 아니면(Json) 목표에 넣지 않는다", async () => {
    mockedRepo.findUserProfileByUserId.mockResolvedValue(buildProfile({ purpose: { some: "obj" } }));
    mockedRepo.findActiveGoalsByUserId.mockResolvedValue([{ target: "친구 만들기" }] as never);

    const context = await assembleUserContext("u1");

    expect(context.goals).toEqual(["친구 만들기"]);
  });
});

describe("buildRecommendationInput", () => {
  it("컨텍스트와 규칙 기반 기준을 함께 반환한다", async () => {
    mockedRepo.findUserProfileByUserId.mockResolvedValue(buildProfile());
    mockedRepo.findRecentMissionRecords.mockResolvedValue([
      buildRecord({ result: "avoidance", mission: { id: "m1", title: "a", category: "stranger", difficulty: 2 } }),
      buildRecord({ result: "failure", mission: { id: "m2", title: "b", category: "stranger", difficulty: 2 } }),
      buildRecord({ result: "success", mission: { id: "m3", title: "c", category: "cafe", difficulty: 2 } }),
    ] as never);

    const { context, criteria } = await buildRecommendationInput("u1");

    expect(context.userId).toBe("u1");
    expect(criteria.targetDifficulty).toBe(1); // 회피/실패 2건 → 하향
    expect(criteria.avoidedCategories).toEqual(["stranger"]);
  });
});

describe("recommendMission (1→2→3 통합)", () => {
  it("매칭 템플릿이 있으면 템플릿 미션을 추천한다", async () => {
    mockedRepo.findUserProfileByUserId.mockResolvedValue(buildProfile());
    mockedRepo.findTemplateMissionsExcluding.mockResolvedValue([
      {
        id: "t1",
        title: "카페에서 음료 추천 물어보기",
        description: "설명",
        difficulty: 1,
        estimated_minutes: 5,
        reward_xp: 10,
        category: "짧은 대화",
      },
    ] as never);

    const result = await recommendMission("u1");

    expect(result.source).toBe("template");
    expect(result.missionId).toBe("t1");
  });

  it("템플릿이 없으면 입문 폴백을 반환한다", async () => {
    mockedRepo.findUserProfileByUserId.mockResolvedValue(buildProfile());
    // findTemplateMissionsExcluding는 beforeEach에서 빈 배열로 mock됨

    const result = await recommendMission("u1");

    expect(result.source).toBe("fallback");
  });

  it("LLM이 미션을 생성하면 템플릿보다 그 결과를 우선한다", async () => {
    mockedRepo.findUserProfileByUserId.mockResolvedValue(buildProfile());
    mockedLlm.generateMissionWithLlm.mockResolvedValue({
      missionId: null,
      title: "LLM 생성 미션",
      description: "설명",
      difficulty: 2,
      estimatedMinutes: 10,
      category: "짧은 대화",
      rewardXp: 20,
      reason: "이유",
      expectedEffect: "효과",
      source: "llm",
    });

    const result = await recommendMission("u1");

    expect(result.source).toBe("llm");
    expect(result.title).toBe("LLM 생성 미션");
    expect(mockedRepo.findTemplateMissionsExcluding).not.toHaveBeenCalled();
  });
});
