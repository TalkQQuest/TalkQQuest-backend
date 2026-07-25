import { RecommendationCriteria, UserContext } from "../dtos/recommendation.dto";

// logger는 env에 의존하므로(config/logger) 먼저 mock해 부트스트랩 의존성을 끊는다.
jest.mock("../../../config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
// env를 mock해 실제 .env(UPSTAGE_API_KEY)와 무관하게 테스트한다. 값은 테스트별로 조정.
jest.mock("../../../config/env", () => ({
  env: {
    UPSTAGE_API_KEY: "test-key",
    UPSTAGE_BASE_URL: "https://api.upstage.ai/v1",
    UPSTAGE_MODEL: "solar-pro",
  },
}));

import { env } from "../../../config/env";
import {
  buildLlmMessages,
  generateMissionWithLlm,
  parseLlmMission,
  pingLlm,
} from "../services/llm.service";

const context: UserContext = {
  userId: "u1",
  personalityType: "introvert",
  statusType: "새내기",
  difficultSituations: ["낯선 사람과 대화"],
  interests: ["카페"],
  goals: ["자신감 향상"],
  practiceTypes: ["가벼운 잡담"],
  level: 1,
  baseDifficulty: 2,
  recentMissions: [],
  isColdStart: true,
};

const criteria: RecommendationCriteria = {
  userId: "u1",
  targetDifficulty: 2,
  avoidedCategories: ["stranger"],
  preferredInterests: ["카페"],
  personalityType: "introvert",
  isColdStart: true,
  difficultyAdjustment: { baseDifficulty: 2, adjustedDifficulty: 2, reason: "kept" },
};

const validJson = JSON.stringify({
  mission_title: "카페에서 음료 추천 물어보기",
  mission_description: "주문할 때 점원에게 추천 음료를 물어보세요.",
  difficulty: 2,
  estimated_minutes: 5,
  category: "짧은 대화",
  reason: "관심사(카페)를 반영했어요.",
  expected_effect: "작은 대화로 자신감을 얻습니다.",
});

describe("buildLlmMessages", () => {
  it("system/user 두 메시지를 만든다", () => {
    const messages = buildLlmMessages(context, criteria);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
  });

  it("user 메시지에 목표 난이도와 회피 카테고리 힌트를 담는다", () => {
    const userContent = buildLlmMessages(context, criteria)[1].content;
    expect(userContent).toContain("targetDifficulty");
    expect(userContent).toContain("stranger");
    expect(userContent).toContain("practiceTypes");
    expect(userContent).toContain("가벼운 잡담");
  });

  it("빈 값은 힌트에서 아예 제외한다 (모델이 빈 값을 인용/해설하지 않도록)", () => {
    const emptyContext: UserContext = {
      ...context,
      goals: [],
      interests: [],
      practiceTypes: [],
      recentMissions: [],
    };
    const emptyCriteria: RecommendationCriteria = {
      ...criteria,
      avoidedCategories: [],
      preferredInterests: [],
    };

    const userContent = buildLlmMessages(emptyContext, emptyCriteria)[1].content;

    expect(userContent).not.toContain("goals");
    expect(userContent).not.toContain("interests");
    expect(userContent).not.toContain("practiceTypes");
    expect(userContent).not.toContain("avoidedCategories");
    expect(userContent).not.toContain("recentMissions");
    expect(userContent).not.toContain("[]"); // 빈 배열이 프롬프트에 노출되지 않아야 함
    expect(userContent).toContain("targetDifficulty"); // 필수 힌트는 유지
  });

  it("공백만 있는 값도 제외한다", () => {
    const userContent = buildLlmMessages(
      { ...context, goals: ["  ", ""] },
      { ...criteria, preferredInterests: [" "] }
    )[1].content;

    expect(userContent).not.toContain("goals");
    expect(userContent).not.toContain("interests");
  });
});

describe("parseLlmMission", () => {
  it("정상 JSON을 RecommendedMission으로 매핑한다", () => {
    const result = parseLlmMission(validJson);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("ok=true여야 함");
    expect(result.mission.source).toBe("llm");
    expect(result.mission.missionId).toBeNull();
    expect(result.mission.title).toBe("카페에서 음료 추천 물어보기");
    expect(result.mission.rewardXp).toBe(20); // difficulty(2) * 10
    expect(result.mission.estimatedMinutes).toBe(5);
  });

  it("```json 코드펜스로 감싼 응답도 파싱한다", () => {
    const result = parseLlmMission("```json\n" + validJson + "\n```");
    expect(result.ok).toBe(true);
  });

  it("JSON이 아니면 invalid_json 사유로 실패한다", () => {
    const result = parseLlmMission("추천 미션은 인사하기입니다.");
    expect(result).toEqual({ ok: false, reason: "invalid_json" });
  });

  it("필수 필드가 빠지면 schema_invalid 사유로 실패한다", () => {
    const missing = JSON.stringify({ mission_title: "제목만 있음" });
    expect(parseLlmMission(missing)).toEqual({ ok: false, reason: "schema_invalid" });
  });

  it("난이도가 범위(1~3)를 벗어나면 schema_invalid 사유로 실패한다", () => {
    const bad = JSON.stringify({ ...JSON.parse(validJson), difficulty: 5 });
    expect(parseLlmMission(bad)).toEqual({ ok: false, reason: "schema_invalid" });
  });
});

describe("generateMissionWithLlm", () => {
  const mockFetch = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (env as { UPSTAGE_API_KEY?: string }).UPSTAGE_API_KEY = "test-key";
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  const okResponse = (content: string) => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content } }] }),
  });

  it("키가 없으면 호출하지 않고 no_api_key 사유를 반환한다", async () => {
    (env as { UPSTAGE_API_KEY?: string }).UPSTAGE_API_KEY = undefined;

    const result = await generateMissionWithLlm(context, criteria);

    expect(result.mission).toBeNull();
    expect(result.fallbackReason).toBe("no_api_key");
    expect(result.promptInput).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("정상 응답이면 mission을 채우고 로깅용 세부를 담는다", async () => {
    mockFetch.mockResolvedValue(okResponse(validJson));

    const result = await generateMissionWithLlm(context, criteria);

    expect(result.mission?.source).toBe("llm");
    expect(result.mission?.title).toBe("카페에서 음료 추천 물어보기");
    expect(result.parseSuccess).toBe(true);
    expect(result.fallbackReason).toBeNull();
    expect(result.rawResponse).toBe(validJson);
    expect(result.llmModel).toBe("solar-pro");
    expect(result.promptInput).not.toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("HTTP 오류(res.ok=false)면 http_error 사유를 반환한다", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });

    const result = await generateMissionWithLlm(context, criteria);
    expect(result.mission).toBeNull();
    expect(result.fallbackReason).toBe("http_error");
  });

  it("네트워크 예외가 나면 http_error 사유로 폴백한다", async () => {
    mockFetch.mockRejectedValue(new Error("network down"));

    const result = await generateMissionWithLlm(context, criteria);
    expect(result.mission).toBeNull();
    expect(result.fallbackReason).toBe("http_error");
  });

  it("타임아웃(AbortError)이면 timeout 사유로 폴백한다", async () => {
    const abortErr = new Error("aborted");
    abortErr.name = "AbortError";
    mockFetch.mockRejectedValue(abortErr);

    const result = await generateMissionWithLlm(context, criteria);
    expect(result.fallbackReason).toBe("timeout");
  });

  it("응답 JSON이 깨져 있으면 invalid_json 사유로 폴백하고 원문을 남긴다", async () => {
    mockFetch.mockResolvedValue(okResponse("not-json"));

    const result = await generateMissionWithLlm(context, criteria);
    expect(result.mission).toBeNull();
    expect(result.fallbackReason).toBe("invalid_json");
    expect(result.rawResponse).toBe("not-json");
  });
});

describe("pingLlm", () => {
  const mockFetch = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (env as { UPSTAGE_API_KEY?: string }).UPSTAGE_API_KEY = "test-key";
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  it("키가 없으면 connected=false, reason=no_api_key", async () => {
    (env as { UPSTAGE_API_KEY?: string }).UPSTAGE_API_KEY = undefined;

    const result = await pingLlm();
    expect(result.connected).toBe(false);
    expect(result.reason).toBe("no_api_key");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("정상 응답이면 connected=true, sample 포함", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "OK!" } }] }),
    });

    const result = await pingLlm();
    expect(result.connected).toBe(true);
    expect(result.sample).toBe("OK!");
    expect(result.model).toBe("solar-pro");
  });

  it("HTTP 오류면 connected=false, reason=http_상태코드", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });

    const result = await pingLlm();
    expect(result.connected).toBe(false);
    expect(result.reason).toBe("http_401");
  });
});
