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
  AI_IDENTITY_PHRASE,
  buildGuideMessages,
  buildOpeningMessage,
  cleanReply,
  generateGuideReply,
  GuideReplyContext,
} from "../services/conversation-llm.service";

const baseCtx: GuideReplyContext = {
  missionTitle: "카페 점원에게 인사하기",
  missionDescription: "주문할 때 먼저 인사를 건네보세요.",
  persona: "카페 바리스타, 친근한 존댓말",
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

  it("미션은 사용자의 과제이지 AI가 먼저 할 일이 아님을 명시한다", () => {
    const system = buildGuideMessages(baseCtx)[0].content;
    expect(system).toContain("사용자가 연습할 과제");
    expect(system).toContain("먼저 꺼내지 마세요");
  });

  it("자기 해설·마크다운 금지 규칙을 담는다", () => {
    const system = buildGuideMessages(baseCtx)[0].content;
    expect(system).toContain("해설하지 않습니다");
    expect(system).toContain("따옴표로 감싸지도 마세요");
  });
});

describe("buildOpeningMessage", () => {
  it("파트너임을 밝히고 현재 배역을 안내한다(B안)", () => {
    const opening = buildOpeningMessage("카페 점원에게 인사하기");
    expect(opening).toContain(AI_IDENTITY_PHRASE);
    expect(opening).toContain("카페 점원에게 인사하기");
  });
});

describe("cleanReply", () => {
  it("답변 끝에 이모지가 붙어 있어도 닫는 따옴표를 걷어낸다", () => {
    // 실제 보고된 형태 — 여는 따옴표 없이 닫는 것만 남아 말풍선에 노출됐다.
    expect(cleanReply('그러면 보통 어떤 방식으로 교환하시나요?" 😊')).toBe(
      "그러면 보통 어떤 방식으로 교환하시나요? 😊"
    );
  });

  it("답변 전체를 감싼 따옴표는 꼬리 이모지를 남기고 벗겨낸다", () => {
    expect(cleanReply('"오늘 날씨 좋네요!" 😊')).toBe("오늘 날씨 좋네요! 😊");
  });

  it("따옴표로만 감싼 일반 답변도 벗겨낸다", () => {
    expect(cleanReply('"안녕하세요, 반가워요."')).toBe("안녕하세요, 반가워요.");
  });

  it("문장 중간의 따옴표(인용)는 건드리지 않는다", () => {
    const text = '친구가 "고마워"라고 하더라고요.';
    expect(cleanReply(text)).toBe(text);
  });

  it("자기 해설 괄호를 제거한다", () => {
    // 실제 보고된 형태
    const raw =
      "저는 AI 도우미예요! 취미 물어보기는 어땠나요? (자연스러운 대화를 이어가기 위한 후속 질문을 덧붙여 봤습니다) 혹시 동아리 활동 중에 해보고 싶은 게 있으신가요?";
    const cleaned = cleanReply(raw);
    expect(cleaned).not.toContain("후속 질문을 덧붙여");
    expect(cleaned).toContain("혹시 동아리 활동 중에");
  });

  it("짧은 감정·행동 묘사 괄호는 남긴다", () => {
    expect(cleanReply("아 그래요? (웃음)")).toBe("아 그래요? (웃음)");
  });

  it("인용 기호와 마크다운 강조를 제거한다", () => {
    expect(cleanReply("> **정말요?** 저도 그래요")).toBe("정말요? 저도 그래요");
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
