// logger는 env에 의존하므로 먼저 mock해 부트스트랩 의존성을 끊는다.
jest.mock("../../../config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../../../config/env", () => ({
  env: {
    UPSTAGE_API_KEY: "test-key",
    UPSTAGE_BASE_URL: "https://api.upstage.ai/v1",
    UPSTAGE_MODEL: "solar-pro",
  },
}));

import { env } from "../../../config/env";
import {
  buildGuideMessages,
  generateGuideReply,
  GuideReplyContext,
} from "../services/conversation-guide.service";
import { AI_IDENTITY_PHRASE } from "../dtos/conversation.constants";

const baseCtx: GuideReplyContext = {
  missionTitle: "카페 점원에게 인사하기",
  missionDescription: "주문할 때 먼저 인사를 건네보세요.",
  persona: "카페 바리스타, 친근한 존댓말",
  userTask: "점원에게 먼저 인사를 건네기",
  flow: ["도입: 가볍게 인사 받기", "전개: 주문 이야기 이어가기", "마무리: 짧게 마무리 인사"],
  matchedRules: [],
  personality: "introvert",
  preferredStyle: "다정하게",
  history: [
    { role: "user", content: "안녕하세요" },
    { role: "guide", content: "안녕하세요! 오늘 기분은 어떠세요?" },
  ],
  latestUserMessage: "좀 긴장돼요",
};

describe("buildGuideMessages", () => {
  it("system + 이전 맥락 + 최신 사용자 메시지를 순서대로 구성한다", () => {
    const messages = buildGuideMessages(baseCtx);
    expect(messages[0].role).toBe("system");
    expect(messages[messages.length - 1]).toEqual({ role: "user", content: "좀 긴장돼요" });
  });

  it("guide 메시지는 assistant, user 메시지는 user로 매핑한다", () => {
    const messages = buildGuideMessages(baseCtx);
    expect(messages[1]).toEqual({ role: "user", content: "안녕하세요" });
    expect(messages[2]).toEqual({ role: "assistant", content: "안녕하세요! 오늘 기분은 어떠세요?" });
  });

  it("system 프롬프트에 미션 제목과 톤(성향/말투) 힌트를 담는다", () => {
    const system = buildGuideMessages(baseCtx)[0].content;
    expect(system).toContain("카페 점원에게 인사하기");
    expect(system).toContain("편안하고 다정한 톤"); // introvert
    expect(system).toContain("다정하게"); // preferredStyle
  });

  it("성향/말투가 없으면 톤 규칙을 넣지 않는다", () => {
    const system = buildGuideMessages({
      ...baseCtx,
      personality: null,
      preferredStyle: null,
    })[0].content;
    expect(system).not.toContain("편안하고 다정한 톤");
    expect(system).not.toContain("선호하는 말투");
  });

  it("이전 맥락이 상한(10개)을 넘으면 최근 것만 넣는다", () => {
    const longHistory = Array.from({ length: 20 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "guide") as "user" | "guide",
      content: `메시지${i}`,
    }));
    const messages = buildGuideMessages({ ...baseCtx, history: longHistory });
    // system(1) + 최근 10 + 최신 user(1)
    expect(messages).toHaveLength(12);
    expect(messages[1].content).toBe("메시지10");
  });

  it("배역 유지·정체 고정 문구·복귀 규칙을 프롬프트에 담는다", () => {
    const system = buildGuideMessages(baseCtx)[0].content;
    expect(system).toContain("상대역을 연기");
    expect(system).toContain(AI_IDENTITY_PHRASE);
    expect(system).toContain("배역으로 완전히 복귀");
  });

  it("사용자가 할 일을 구체적으로 못박고 AI에게 금지한다", () => {
    const system = buildGuideMessages(baseCtx)[0].content;
    // 추상 규칙("과제에 해당하는 말")은 모델이 좁게 해석해 통하지 않았다 → 행동을 직접 지정한다.
    expect(system).toContain("사용자가 해야 할 일: 점원에게 먼저 인사를 건네기");
    expect(system).toContain("절대로 먼저 하지 않고");
  });

  it("AI가 자기 경험·감상을 먼저 꺼내지 못하게 한다", () => {
    // 실제 사례: 미션이 "영화 감상 공유"인데 AI가 자기 감상을 먼저 말해버렸다.
    const system = buildGuideMessages(baseCtx)[0].content;
    expect(system).toContain("당신의 경험·감상·의견·예시를 **먼저 꺼내지 마세요.**");
  });

  it("미션 설명은 사용자용 안내문임을 라벨로 못박아 넣는다", () => {
    const system = buildGuideMessages(baseCtx)[0].content;
    expect(system).toContain("당신에게 내리는 지시가 아닙니다");
  });

  it("대화 흐름 단계를 순서대로 프롬프트에 넣는다", () => {
    const system = buildGuideMessages(baseCtx)[0].content;
    expect(system).toContain("대화 흐름");
    expect(system).toContain("1. 도입: 가볍게 인사 받기");
    expect(system).toContain("3. 마무리: 짧게 마무리 인사");
  });

  it("선별된 상황 규칙만 넣고, 대본이 아니라 방향임을 명시한다", () => {
    const system = buildGuideMessages({
      ...baseCtx,
      matchedRules: [{ when: "무슨 말을 할지 모르겠다고 함", then: "선택지를 좁혀 하나만 물어보기" }],
    })[0].content;
    expect(system).toContain("무슨 말을 할지 모르겠다고 함 → 선택지를 좁혀 하나만 물어보기");
    expect(system).toContain("문장을 그대로 옮기지 말고");
  });

  it("매칭된 규칙이 없으면 상황 지침 블록을 넣지 않는다", () => {
    const system = buildGuideMessages(baseCtx)[0].content;
    expect(system).not.toContain("지금 상황에 해당할 수 있는 지침");
  });

  it("플레이북이 없는 미션이면(구 미션) 흐름 블록을 넣지 않는다", () => {
    const system = buildGuideMessages({ ...baseCtx, flow: [] })[0].content;
    expect(system).not.toContain("대화 흐름");
  });

  it("userTask가 없으면(구 대화) 해당 규칙을 넣지 않는다", () => {
    const system = buildGuideMessages({ ...baseCtx, userTask: null })[0].content;
    expect(system).not.toContain("사용자가 해야 할 일:");
    // 일반 규칙은 그대로 적용된다.
    expect(system).toContain("당신의 경험·감상·의견·예시를 **먼저 꺼내지 마세요.**");
  });

  it("자기 해설·마크다운 금지 규칙을 담는다", () => {
    const system = buildGuideMessages(baseCtx)[0].content;
    expect(system).toContain("해설하지 않습니다");
    expect(system).toContain("따옴표로 감싸지도 마세요");
  });
});

describe("generateGuideReply", () => {
  const mockFetch = jest.fn();
  const okResponse = (content: string) => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content } }] }),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (env as { UPSTAGE_API_KEY?: string }).UPSTAGE_API_KEY = "test-key";
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  it("키가 없으면 호출하지 않고 null을 반환한다", async () => {
    (env as { UPSTAGE_API_KEY?: string }).UPSTAGE_API_KEY = undefined;
    const reply = await generateGuideReply(baseCtx);
    expect(reply).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("정상 응답이면 대화 문자열을 반환한다", async () => {
    mockFetch.mockResolvedValue(okResponse("긴장되는 게 당연해요. 천천히 해봐요!"));
    const reply = await generateGuideReply(baseCtx);
    expect(reply).toBe("긴장되는 게 당연해요. 천천히 해봐요!");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("응답을 감싼 따옴표는 벗겨낸다", async () => {
    mockFetch.mockResolvedValue(okResponse('"좋아요, 잘하고 있어요!"'));
    expect(await generateGuideReply(baseCtx)).toBe("좋아요, 잘하고 있어요!");
  });

  it("1차 실패 시 1회 재시도하고, 재시도가 성공하면 그 응답을 쓴다 (5.5)", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
      .mockResolvedValueOnce(okResponse("다시 생성한 응답"));
    const reply = await generateGuideReply(baseCtx);
    expect(reply).toBe("다시 생성한 응답");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("재시도까지 실패하면 null을 반환한다 (→ 템플릿 폴백)", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const reply = await generateGuideReply(baseCtx);
    expect(reply).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(2); // 최초 + 재시도 1회
  });

  it("네트워크 예외가 나도 null을 반환한다", async () => {
    mockFetch.mockRejectedValue(new Error("network down"));
    expect(await generateGuideReply(baseCtx)).toBeNull();
  });

  it("빈 응답(content 없음)도 실패로 처리한다", async () => {
    mockFetch.mockResolvedValue(okResponse("   "));
    expect(await generateGuideReply(baseCtx)).toBeNull();
  });
});
