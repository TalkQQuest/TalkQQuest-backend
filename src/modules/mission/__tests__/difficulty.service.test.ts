import { MissionResult } from "@prisma/client";
import { RecentMissionRecord, UserContext } from "../dtos/recommendation.dto";
import {
  adjustDifficulty,
  buildRecommendationCriteria,
  collectAvoidedCategories,
  MAX_DIFFICULTY,
  MIN_DIFFICULTY,
  seedDifficultyFromPersonality,
} from "../services/difficulty.service";

// 최신순(created_at desc) 기록 1건을 만드는 헬퍼.
const rec = (
  result: MissionResult,
  category = "smalltalk",
  difficulty = 2
): RecentMissionRecord => ({
  missionId: "m1",
  title: "미션",
  category,
  difficulty,
  result,
  createdAt: new Date(),
});

describe("seedDifficultyFromPersonality", () => {
  it("내향형은 최저 난이도에서 출발한다", () => {
    expect(seedDifficultyFromPersonality("introvert")).toBe(MIN_DIFFICULTY);
  });

  it("외향/양향/미지정은 보통(2) 난이도에서 출발한다", () => {
    expect(seedDifficultyFromPersonality("extrovert")).toBe(2);
    expect(seedDifficultyFromPersonality("ambivert")).toBe(2);
    expect(seedDifficultyFromPersonality(null)).toBe(2);
  });
});

describe("adjustDifficulty", () => {
  it("최근 3건 중 회피/실패가 2건 이상이면 한 단계 낮춘다", () => {
    const result = adjustDifficulty(
      [rec("avoidance"), rec("failure"), rec("success")],
      2
    );
    expect(result.adjustedDifficulty).toBe(1);
    expect(result.reason).toBe("lowered_repeated_avoidance");
  });

  it("최근 3건이 모두 성공이면 한 단계 올린다", () => {
    const result = adjustDifficulty(
      [rec("success"), rec("success"), rec("success")],
      2
    );
    expect(result.adjustedDifficulty).toBe(3);
    expect(result.reason).toBe("raised_streak_success");
  });

  it("성공/실패가 섞여 있으면 유지한다", () => {
    const result = adjustDifficulty(
      [rec("success"), rec("failure"), rec("success")],
      2
    );
    expect(result.adjustedDifficulty).toBe(2);
    expect(result.reason).toBe("kept");
  });

  it("기록이 3건 미만이면 전부 성공이어도 올리지 않는다", () => {
    const result = adjustDifficulty([rec("success"), rec("success")], 2);
    expect(result.adjustedDifficulty).toBe(2);
    expect(result.reason).toBe("kept");
  });

  it("최근 3건만 보고 그 이전 기록은 무시한다", () => {
    // 최신 3건은 전부 성공, 그 뒤(오래된) 회피 2건은 판단에서 제외되어야 한다.
    const result = adjustDifficulty(
      [rec("success"), rec("success"), rec("success"), rec("avoidance"), rec("avoidance")],
      2
    );
    expect(result.reason).toBe("raised_streak_success");
  });

  it("최저/최고 난이도에서 범위를 벗어나지 않는다", () => {
    const lowered = adjustDifficulty([rec("failure"), rec("avoidance")], MIN_DIFFICULTY);
    expect(lowered.adjustedDifficulty).toBe(MIN_DIFFICULTY);

    const raised = adjustDifficulty(
      [rec("success"), rec("success"), rec("success")],
      MAX_DIFFICULTY
    );
    expect(raised.adjustedDifficulty).toBe(MAX_DIFFICULTY);
  });

  it("baseDifficulty를 산출물에 그대로 담아둔다", () => {
    const result = adjustDifficulty([rec("success")], 2);
    expect(result.baseDifficulty).toBe(2);
  });
});

describe("collectAvoidedCategories", () => {
  it("회피/실패가 2건 이상 쌓인 카테고리를 반환한다", () => {
    const categories = collectAvoidedCategories([
      rec("avoidance", "stranger"),
      rec("failure", "stranger"),
      rec("success", "cafe"),
    ]);
    expect(categories).toEqual(["stranger"]);
  });

  it("1건뿐인 카테고리는 제외하지 않는다", () => {
    const categories = collectAvoidedCategories([
      rec("avoidance", "stranger"),
      rec("success", "cafe"),
      rec("success", "school"),
    ]);
    expect(categories).toEqual([]);
  });

  it("성공 기록은 회피 집계에 넣지 않는다", () => {
    const categories = collectAvoidedCategories([
      rec("success", "stranger"),
      rec("success", "stranger"),
      rec("success", "stranger"),
    ]);
    expect(categories).toEqual([]);
  });

  it("최근 3건 창을 벗어난 회피는 집계하지 않는다", () => {
    // stranger 회피 2건이 4·5번째(오래된)라 창 밖 → 제외 대상 아님.
    const categories = collectAvoidedCategories([
      rec("success", "cafe"),
      rec("success", "cafe"),
      rec("success", "cafe"),
      rec("avoidance", "stranger"),
      rec("avoidance", "stranger"),
    ]);
    expect(categories).toEqual([]);
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
    recentMissions: [rec("avoidance", "stranger"), rec("failure", "stranger"), rec("success")],
    isColdStart: false,
  };

  it("조정된 난이도를 targetDifficulty로 사용한다", () => {
    const criteria = buildRecommendationCriteria(baseContext);
    expect(criteria.targetDifficulty).toBe(1); // 회피/실패 2건 → 하향
    expect(criteria.difficultyAdjustment.reason).toBe("lowered_repeated_avoidance");
  });

  it("회피 카테고리와 관심사를 그대로 담는다", () => {
    const criteria = buildRecommendationCriteria(baseContext);
    expect(criteria.avoidedCategories).toEqual(["stranger"]);
    expect(criteria.preferredInterests).toEqual(["카페", "산책"]);
  });

  it("성향과 콜드스타트 플래그를 전달한다", () => {
    const criteria = buildRecommendationCriteria({ ...baseContext, isColdStart: true });
    expect(criteria.personalityType).toBe("introvert");
    expect(criteria.isColdStart).toBe(true);
    expect(criteria.userId).toBe("u1");
  });
});
