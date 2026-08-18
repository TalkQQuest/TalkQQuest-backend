import { RecentMissionRecord, UserContext } from "../dtos/recommendation.dto";
import {
  buildRecommendationCriteria,
  decideDifficulty,
  MAX_DIFFICULTY,
  MIN_DIFFICULTY,
  seedDifficultyFromPersonality,
  STREAK_PROMOTION_THRESHOLD,
} from "../services/difficulty.service";

// #150 — result(success/failure/avoidance) 기반 규칙(adjustDifficulty·collectAvoidedCategories)은
// 제거됐다. 미션-대화에 실패 개념이 없어 result에는 항상 success가 들어왔고, 그 탓에 상향 규칙이
// 매번 발동해 난이도가 3에 고정되고 하향은 한 번도 걸리지 않았다.
// 이제 난이도는 성장 프로필의 제안을 기준 난이도 ±1로 클램프해서 정한다.
//
// #244 — 성장 프로필 제안(suggestedDifficulty)은 피드백 표본이 쌓이기 전엔 계속 null이라,
// 그 전까지 난이도가 한쪽에 고정되는 문제가 있었다. 제안이 없을 때는 연속 완료 횟수를
// 보조 신호로 써서 승급을 시도한다.

const rec = (category = "smalltalk", difficulty = 2): RecentMissionRecord => ({
  missionId: "m1",
  title: "미션",
  category,
  difficulty,
  createdAt: new Date(),
});

describe("seedDifficultyFromPersonality", () => {
  it("내향형은 최저 난이도에서 출발한다", () => {
    expect(seedDifficultyFromPersonality("introvert")).toBe(MIN_DIFFICULTY);
  });

  it("외향형은 보통 난이도에서 출발한다", () => {
    expect(seedDifficultyFromPersonality("extrovert")).toBe(2);
  });

  it("성향 정보가 없으면 보통 난이도로 둔다", () => {
    expect(seedDifficultyFromPersonality(null)).toBe(2);
  });
});

describe("decideDifficulty", () => {
  it("제안이 없고 연속 완료도 없으면 기준 난이도를 그대로 쓴다", () => {
    const decision = decideDifficulty([], 2, null);
    expect(decision.targetDifficulty).toBe(2);
    expect(decision.source).toBe("base");
  });

  it("제안이 기준과 한 단계 차이면 그대로 반영한다", () => {
    expect(decideDifficulty([], 2, 3)).toMatchObject({
      targetDifficulty: 3,
      source: "growth_profile",
    });
    expect(decideDifficulty([], 2, 1)).toMatchObject({
      targetDifficulty: 1,
      source: "growth_profile",
    });
  });

  // 클램프가 없으면 요약이 한 번 어긋났을 때 난이도가 한쪽 끝으로 튀고 그대로 굳는다.
  // 방금 걷어낸 문제(난이도 3 고정)를 다른 경로로 되풀이하지 않기 위한 안전장치다.
  it("제안이 기준에서 두 단계 이상 떨어져 있으면 한 단계만 움직인다", () => {
    expect(decideDifficulty([], 1, 3).targetDifficulty).toBe(2);
    expect(decideDifficulty([], 3, 1).targetDifficulty).toBe(2);
  });

  it("클램프 후에도 전체 난이도 범위를 벗어나지 않는다", () => {
    expect(decideDifficulty([], MAX_DIFFICULTY, MAX_DIFFICULTY).targetDifficulty).toBe(MAX_DIFFICULTY);
    expect(decideDifficulty([], MIN_DIFFICULTY, MIN_DIFFICULTY).targetDifficulty).toBe(MIN_DIFFICULTY);
  });

  it("기준 난이도가 범위를 벗어나 있어도 먼저 범위 안으로 당긴다", () => {
    expect(decideDifficulty([], 9, null).targetDifficulty).toBe(MAX_DIFFICULTY);
    expect(decideDifficulty([], 0, null).targetDifficulty).toBe(MIN_DIFFICULTY);
  });

  it("제안이 기준과 같으면 source를 base로 둔다", () => {
    expect(decideDifficulty([], 2, 2)).toMatchObject({ targetDifficulty: 2, source: "base" });
  });

  // #244 — 제안이 없을 때(표본 부족) 연속 완료 횟수로 승급을 시도하는 보조 신호.
  describe("연속 완료 승급(streak_promotion)", () => {
    it("같은 난이도를 임계치만큼 연속 완료하면 한 단계 승급한다", () => {
      const recentMissions = Array.from({ length: STREAK_PROMOTION_THRESHOLD }, () => rec("smalltalk", 1));
      const decision = decideDifficulty(recentMissions, 1, null);
      expect(decision.targetDifficulty).toBe(2);
      expect(decision.source).toBe("streak_promotion");
    });

    it("연속 횟수가 임계치 미만이면 승급하지 않는다", () => {
      const recentMissions = Array.from({ length: STREAK_PROMOTION_THRESHOLD - 1 }, () => rec("smalltalk", 1));
      const decision = decideDifficulty(recentMissions, 1, null);
      expect(decision.targetDifficulty).toBe(1);
      expect(decision.source).toBe("base");
    });

    it("연속 기록 중간에 다른 난이도가 섞이면 그 지점에서 연속이 끊긴다", () => {
      const recentMissions = [rec("smalltalk", 1), rec("smalltalk", 1), rec("smalltalk", 2)];
      const decision = decideDifficulty(recentMissions, 1, null);
      expect(decision.source).toBe("base");
    });

    it("이미 최고 난이도면 연속 완료해도 더 올리지 않는다", () => {
      const recentMissions = Array.from({ length: STREAK_PROMOTION_THRESHOLD }, () =>
        rec("smalltalk", MAX_DIFFICULTY)
      );
      const decision = decideDifficulty(recentMissions, MAX_DIFFICULTY, null);
      expect(decision.targetDifficulty).toBe(MAX_DIFFICULTY);
      expect(decision.source).toBe("base");
    });

    it("성장 프로필 제안이 있으면 연속 완료 여부와 무관하게 제안을 우선한다", () => {
      const recentMissions = Array.from({ length: STREAK_PROMOTION_THRESHOLD }, () => rec("smalltalk", 1));
      const decision = decideDifficulty(recentMissions, 1, 1);
      expect(decision.source).toBe("base"); // 제안(1)이 기준(1)과 같아 base로 유지
    });
  });
});

describe("buildRecommendationCriteria", () => {
  const baseContext: UserContext = {
    userId: "u1",
    personalityType: "introvert",
    statusType: "새내기",
    difficultSituations: ["낯선 사람과 대화"],
    interests: ["카페", "산책"],
    goals: ["자신감 향상"],
    practiceTypes: ["가벼운 잡담"],
    level: 1,
    baseDifficulty: 2,
    // 서로 다른 카테고리/난이도라 연속 승급(streak_promotion)이 발동하지 않는 조합으로 고정한다.
    recentMissions: [rec("stranger", 2), rec("stranger", 1), rec("cafe", 2)],
    isColdStart: false,
    suggestedDifficulty: null,
    growth: null,
  };

  it("성장 프로필 제안이 없으면 기준 난이도를 그대로 쓴다", () => {
    const criteria = buildRecommendationCriteria(baseContext);
    expect(criteria.targetDifficulty).toBe(2);
    expect(criteria.difficulty.source).toBe("base");
  });

  it("성장 프로필 제안을 클램프해서 targetDifficulty로 사용한다", () => {
    const criteria = buildRecommendationCriteria({ ...baseContext, suggestedDifficulty: 1 });
    expect(criteria.targetDifficulty).toBe(1);
    expect(criteria.difficulty).toMatchObject({ baseDifficulty: 2, source: "growth_profile" });
  });

  it("관심사를 그대로 담는다", () => {
    const criteria = buildRecommendationCriteria(baseContext);
    expect(criteria.preferredInterests).toEqual(["카페", "산책"]);
  });

  it("성향과 콜드스타트 플래그를 전달한다", () => {
    const criteria = buildRecommendationCriteria({ ...baseContext, isColdStart: true });
    expect(criteria.personalityType).toBe("introvert");
    expect(criteria.isColdStart).toBe(true);
    expect(criteria.userId).toBe("u1");
  });
});