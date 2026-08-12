import {
    RecommendationCriteria,
  TemplateMissionCandidate,
} from "../dtos/recommendation.dto";
import * as repository from "../repositories/mission.repository";
import {
  buildTemplateReason,
  INTRO_FALLBACK_MISSION,
  pickTemplateMission,
  recommendFromTemplate,
} from "../services/template.service";

jest.mock("../repositories/mission.repository");
const mockedRepo = jest.mocked(repository);

const candidate = (
  overrides: Partial<TemplateMissionCandidate> = {}
): TemplateMissionCandidate => ({
  id: "m1",
  title: "미션",
  description: "설명",
  difficulty: 2,
  estimatedMinutes: 10,
  rewardXp: 20,
  category: "짧은 대화",
  ...overrides,
});

const criteriaWith = (
  overrides: Partial<RecommendationCriteria> = {}
): RecommendationCriteria => ({
  userId: "u1",
  targetDifficulty: 2,
  preferredInterests: [],
  personalityType: "introvert",
  isColdStart: false,
    difficulty: { baseDifficulty: 2, targetDifficulty: 2, source: "base" },
  ...overrides,
});

describe("pickTemplateMission", () => {
  it("후보가 없으면 null을 반환한다", () => {
    expect(pickTemplateMission([], criteriaWith())).toBeNull();
  });

  it("목표 난이도에 가장 가까운 후보를 고른다", () => {
    const picked = pickTemplateMission(
      [
        candidate({ id: "easy", difficulty: 1 }),
        candidate({ id: "hard", difficulty: 3 }),
        candidate({ id: "exact", difficulty: 2 }),
      ],
      criteriaWith({ targetDifficulty: 2 })
    );
    expect(picked?.id).toBe("exact");
  });

  it("난이도가 같으면 관심사와 맞는 후보를 우선한다", () => {
    const picked = pickTemplateMission(
      [
        candidate({ id: "plain", difficulty: 2, category: "학교생활", title: "과제 물어보기" }),
        candidate({ id: "interest", difficulty: 2, category: "카페", title: "음료 추천 받기" }),
      ],
      criteriaWith({ targetDifficulty: 2, preferredInterests: ["카페"] })
    );
    expect(picked?.id).toBe("interest");
  });

  it("제목에 관심사 키워드가 있어도 매칭으로 본다", () => {
    const picked = pickTemplateMission(
      [
        candidate({ id: "plain", difficulty: 2, category: "친구 만들기", title: "인사하기" }),
        candidate({ id: "byTitle", difficulty: 2, category: "친구 만들기", title: "산책하며 대화하기" }),
      ],
      criteriaWith({ targetDifficulty: 2, preferredInterests: ["산책"] })
    );
    expect(picked?.id).toBe("byTitle");
  });

  it("회피 카테고리는 방어적으로 제외한다", () => {
    const picked = pickTemplateMission(
      [
        candidate({ id: "avoided", difficulty: 2, category: "stranger" }),
        candidate({ id: "ok", difficulty: 2, category: "짧은 대화" }),
      ],
      criteriaWith({ targetDifficulty: 2 })
    );
    // #150 — 회피 카테고리 제외가 사라졌으므로 난이도·관심사 순위로만 고른다.
    expect(picked?.id).toBe("avoided");
  });

  it("후보가 하나도 없으면 null을 반환한다", () => {
    expect(pickTemplateMission([], criteriaWith())).toBeNull();
  });

  it("조건이 같으면 원래 순서(안정 정렬)를 유지한다", () => {
    const picked = pickTemplateMission(
      [candidate({ id: "first" }), candidate({ id: "second" })],
      criteriaWith()
    );
    expect(picked?.id).toBe("first");
  });
});

describe("buildTemplateReason", () => {
  it("콜드스타트면 성향 기반 문구를 준다", () => {
    expect(buildTemplateReason(criteriaWith({ isColdStart: true }))).toContain("성향");
  });

  it("성장 프로필이 난이도를 낮췄으면 그 근거를 알린다", () => {
    const text = buildTemplateReason(
      criteriaWith({
        isColdStart: false,
        difficulty: { baseDifficulty: 3, targetDifficulty: 2, source: "growth_profile" },
      })
    );
    expect(text).toContain("편한 난이도");
  });

  it("성장 프로필이 난이도를 올렸으면 그 근거를 알린다", () => {
    const text = buildTemplateReason(
      criteriaWith({
        isColdStart: false,
        difficulty: { baseDifficulty: 1, targetDifficulty: 2, source: "growth_profile" },
      })
    );
    expect(text).toContain("올린");
  });

  it("제안이 없어 기준 난이도를 그대로 썼으면 중립 문구를 준다", () => {
    const text = buildTemplateReason(
      criteriaWith({
        isColdStart: false,
        difficulty: { baseDifficulty: 2, targetDifficulty: 2, source: "base" },
      })
    );
    expect(text).toContain("맞춰");
  });
});

describe("recommendFromTemplate", () => {
  beforeEach(() => jest.clearAllMocks());

  it("매칭 템플릿이 있으면 그 미션을 추천 형태로 반환한다", async () => {
    mockedRepo.findTemplateMissions.mockResolvedValue([
      {
        id: "m2",
        title: "카페에서 음료 추천 물어보기",
        description: "설명",
        difficulty: 2,
        estimated_minutes: 5,
        reward_xp: 10,
        category: "짧은 대화",
      },
    ] as never);

    const result = await recommendFromTemplate(criteriaWith({ targetDifficulty: 2 }));

    expect(result.source).toBe("template");
    expect(result.missionId).toBe("m2");
    expect(result.estimatedMinutes).toBe(5); // snake_case → camelCase 매핑 확인
    expect(result.reason).toContain("맞춰");
  });

  it("매칭 템플릿이 없으면 입문 폴백 미션을 반환한다", async () => {
    mockedRepo.findTemplateMissions.mockResolvedValue([] as never);

    const result = await recommendFromTemplate(criteriaWith());

    expect(result).toEqual(INTRO_FALLBACK_MISSION);
    expect(result.source).toBe("fallback");
    expect(result.missionId).toBeNull();
  });
});
