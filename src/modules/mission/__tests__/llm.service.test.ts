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
  suggestedDifficulty: null,
  growth: null,
};

const criteria: RecommendationCriteria = {
  userId: "u1",
  targetDifficulty: 2,
  preferredInterests: ["카페"],
  personalityType: "introvert",
  isColdStart: true,
  difficulty: { baseDifficulty: 2, targetDifficulty: 2, source: "base" },
};

const setupGuideline = {
  defaults: {
    environment: "daily_place",
    partnerRole: "other",
    intimacyLevel: 2,
    formalityLevel: 4,
    partnerGender: "female",
    partnerAgeGroup: "twenties",
  },
  disabled: {
    environment: ["daily_place", "online"],
    partnerRole: [],
    intimacyLevel: [2, 5],
    formalityLevel: [],
    partnerGender: [],
    partnerAgeGroup: [],
  },
  tags: [" 첫 만남 ", "", "첫 만남", "가벼운 질문"],
};

const validJson = JSON.stringify({
  mission_title: "카페에서 음료 추천 물어보기",
  mission_description: "주문할 때 점원에게 추천 음료를 물어보세요.",
  difficulty: 2,
  estimated_minutes: 5,
  category: "짧은 대화",
  reason: "관심사(카페)를 반영했어요.",
  expected_effect: "작은 대화로 자신감을 얻습니다.",
  preparation_tip: "메뉴판을 미리 살펴보면 편해요.",
  caution: "점원이 바빠 보이면 짧게 물어보세요.",
  setup_guideline: setupGuideline,
});

describe("buildLlmMessages", () => {
  it("system/user 두 메시지를 만든다", () => {
    const messages = buildLlmMessages(context, criteria);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
  });

  it("성별 기본값은 중요도와 무관하게 male 또는 female만 생성하도록 명시한다", () => {
    const systemContent = buildLlmMessages(context, criteria)[0].content;

    expect(systemContent).toContain('defaults.partnerGender는 필수');
    expect(systemContent).toContain('"male" 또는 "female" 중 하나를 반드시 선택');
    expect(systemContent).toContain('"other", "any", "unknown", null');
    expect(systemContent).toContain('"partnerGender": "female"');
  });

  it("disabled는 비추천값이 아니라 명백히 모순되는 값만 제한하도록 명시한다", () => {
    const systemContent = buildLlmMessages(context, criteria)[0].content;

    expect(systemContent).toContain('"덜 추천됨", "어색함", "흔하지 않음", "일반적이지 않음"은 disabled 사유가 아닙니다');
    expect(systemContent).toContain("판단이 조금이라도 애매하면 disabled에 넣지 않고 허용");
    expect(systemContent).toContain("disabled의 모든 배열이 빈 배열인 결과는 정상이며 권장");
    expect(systemContent).toContain(
      "partnerGender와 partnerAgeGroup은 미션 자체에서 특정 성별이나 연령이 필수라는 전제가 명시된 경우가 아니면 반드시 빈 배열"
    );
    expect(systemContent).toContain(
      "극단값도 단순히 부자연스럽거나 덜 추천된다는 이유로 제한하지 않습니다"
    );
    expect(systemContent).toContain("이웃 가게 주인과 간단한 안부 인사 나누기");
    expect(systemContent).toContain("intimacyLevel과 formalityLevel을 포함한 disabled 배열을 비워 둡니다");
    expect(systemContent).toContain(
      "partnerRole도 미션 설명에서 특정 인간관계가 핵심 전제로 명시된 경우에만"
    );
    expect(systemContent).toContain('"친구에게 사과하기"');
    expect(systemContent).toContain(
      '"카페 직원에게 인사하기", "가게 주인과 대화하기"'
    );
    expect(systemContent).toContain("상황적 대화 대상일 뿐 특정 인간관계를 전제하지 않는 미션");
    expect(systemContent).toContain("disabled.partnerRole을 빈 배열로 둡니다");
  });

  it("user 메시지에 목표 난이도와 연습 유형 힌트를 담는다", () => {
    const userContent = buildLlmMessages(context, criteria)[1].content;
    expect(userContent).toContain("targetDifficulty");
    expect(userContent).toContain("practiceTypes");
    expect(userContent).toContain("가벼운 잡담");
  });

  // #150 — 성장 프로필이 있으면 프롬프트에 실린다. 이게 result를 대체하는 신호다.
  it("성장 프로필이 있으면 growth 힌트로 담는다", () => {
    const userContent = buildLlmMessages(
      {
        ...context,
        growth: {
          summary: "질문은 잘 하지만 답변을 이어받는 부분이 아쉬워요",
          strengths: ["먼저 인사를 건넴"],
          improvements: ["상대 답변에 되묻기"],
          struggleSituations: [
            { environment: "school", partnerRole: "senior", category: "짧은 대화" },
          ],
        },
      },
      criteria
    )[1].content;

    expect(userContent).toContain("growth");
    expect(userContent).toContain("되묻기");
    expect(userContent).toContain("senior");
  });

  // 미션에 실패 개념이 없어 result에는 항상 success가 들어온다.
  // 그대로 넣으면 모델에게 "전부 성공했다"는 잘못된 신호만 준다.
  it("최근 미션 이력에 result를 담지 않는다", () => {
    const userContent = buildLlmMessages(
      {
        ...context,
        recentMissions: [
          {
            missionId: "m1",
            title: "카페에서 주문하기",
            category: "짧은 대화",
            difficulty: 2,
            createdAt: new Date(),
          },
        ],
      },
      criteria
    )[1].content;

    expect(userContent).toContain("카페에서 주문하기");
    expect(userContent).not.toContain("result");
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
    expect(result.mission.setupGuideline).toEqual({
      ...setupGuideline,
      disabled: {
        ...setupGuideline.disabled,
        environment: ["online"],
        intimacyLevel: [5],
      },
      tags: ["첫 만남", "가벼운 질문"],
      note: null,
      recommendedTopics: [],
    });
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

  it("setupGuideline만 잘못되면 미션은 유지하고 가이드라인만 null로 처리한다", () => {
    const bad = JSON.stringify({ ...JSON.parse(validJson), setup_guideline: { defaults: {} } });
    const result = parseLlmMission(bad);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("ok=true여야 함");
    expect(result.mission.title).toBe("카페에서 음료 추천 물어보기");
    expect(result.mission.setupGuideline).toBeNull();
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
