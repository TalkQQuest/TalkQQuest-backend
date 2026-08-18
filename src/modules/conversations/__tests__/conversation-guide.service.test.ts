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
  flowStep: "도입: 가볍게 인사 받기",
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

  it("서버가 정한 흐름 단계 하나만 넣는다", () => {
    // 단계를 여러 개 주면 모델이 한 턴에 다 하려 하거나 메타 발화를 시작해 거부율이 올라간다.
    const system = buildGuideMessages(baseCtx)[0].content;
    expect(system).toContain("지금 대화 단계: 도입: 가볍게 인사 받기");
    expect(system).not.toContain("마무리");
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
    const system = buildGuideMessages({ ...baseCtx, flowStep: null })[0].content;
    expect(system).not.toContain("지금 대화 단계");
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

  // #251 — 사용자가 "대화도 하기 싫어요"라고 하거나 "닥쳐. 말 걸지 마."라고 해도 AI가
  // "저도 그런 경험이 있어요", "흥미롭네요, 더 얘기해주세요!"처럼 대화를 계속 유도했다.
  describe("대화 중단 의사·적대적 발화 규칙(#251)", () => {
    it("중단 의사·적대적 발화에는 후속 질문을 붙이지 말라고 지시한다", () => {
      const system = buildGuideMessages(baseCtx)[0].content;
      expect(system).toContain("대화를 그만하려는 의사·적대적 발화에 대한 규칙:");
      expect(system).toContain("**후속 질문을 덧붙이지 않습니다.**");
      expect(system).toContain("상대의 의사를 존중해 짧게 대화를 맺습니다");
    });

    it("무례한 발화에는 맞받지 않고 차분하게 경계를 표현하도록 한다", () => {
      const system = buildGuideMessages(baseCtx)[0].content;
      expect(system).toContain("감정적으로 맞받지 않고");
      expect(system).toContain("차분하게 경계를 표현");
    });

    // 이 규칙이 맥락 이탈 규칙보다 뒤에 있어, 우선순위를 명시하지 않으면 중단 의사가
    // "갑자기 딴소리"로 분류돼 당황 반응 후 원래 상황으로 돌아간다(이 버그의 실제 증상).
    it("맥락 이탈 규칙보다 우선한다는 것을 명시한다", () => {
      const system = buildGuideMessages(baseCtx)[0].content;
      expect(system).toContain("위 맥락 이탈 규칙을 적용하지 않습니다");
    });

    // 회귀 방어: 실제 LLM 검증에서 "죽고 싶어요. 말 걸지 마세요."에 안전 응답 대신
    // 중단 의사 응답이 나왔다(변경 전에는 위기 상담번호까지 안내하던 발화). 표면이 겹치는
    // 안전 발화에서 이 규칙이 먼저 걸리지 않도록 양쪽에서 우선순위를 못박는다.
    it("안전 규칙 쪽에도 이 규칙보다 우선한다고 명시한다", () => {
      const system = buildGuideMessages(baseCtx)[0].content;
      expect(system).toContain("다른 모든 규칙(맥락 이탈 규칙, 대화 중단 의사 규칙 포함)보다 이 규칙을 우선");
      expect(system).toContain("그 말을 이유로 물러나지 않습니다");
    });

    it("중단 의사 규칙 쪽에는 적용 전 안전 여부를 먼저 확인하도록 절차를 적는다", () => {
      const system = buildGuideMessages(baseCtx)[0].content;
      expect(system).toContain("**적용 전 확인**");
      expect(system).toContain("이 규칙을 적용하지 말고 위 안전 규칙만 따릅니다");
    });

    // 완성된 예시 문장을 주면 모델이 그대로 복사해 붙였다(안전 발화에까지 나왔다).
    it("복사 가능한 완성 문장 대신 방향만 예시로 준다", () => {
      const system = buildGuideMessages(baseCtx)[0].content;
      expect(system).toContain("맞는 방향:");
      expect(system).not.toContain("불편하셨다면 죄송해요");
    });

    // 말투 규칙의 "필요하면 짧은 후속 질문을 덧붙입니다"가 뒤에 무조건형으로 남아 있으면
    // 모델이 뒤 지시를 우선해 후속 질문을 다시 붙인다.
    it("말투 규칙의 후속 질문 지시에도 예외를 함께 적어 규칙이 되살아나지 않게 한다", () => {
      const system = buildGuideMessages(baseCtx)[0].content;
      expect(system).toContain(
        "짧은 후속 질문을 덧붙입니다(위 중단 의사·적대적 발화 규칙에 해당할 때는 덧붙이지 않습니다)"
      );
    });
  });
});

// #252 — 형식 검증만으로는 "형식은 맞지만 내용이 무관한" 답변을 못 걸러낸다. 형식 검증을
// 통과한 답변마다 별도 호출(judge)로 관련성까지 확인하고, 관련 없다고 판정되면 재생성한다.
// 그래서 아래 테스트들은 "생성 호출"과 "관련성 검증 호출"이 항상 짝을 이뤄 fetch가
// 호출된다고 가정한다(생성이 실패/형식 위반이면 관련성 호출 자체가 없다).
describe("generateGuideReply", () => {
  const mockFetch = jest.fn();
  const okResponse = (content: string) => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content } }] }),
  });
  const errorResponse = { ok: false, status: 500, json: async () => ({}) };
  const relevantJudge = () => okResponse("RELEVANT");
  const irrelevantJudge = () => okResponse("IRRELEVANT");

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

  it("정상 응답 + 관련성 통과면 대화 문자열을 반환한다", async () => {
    mockFetch
      .mockResolvedValueOnce(okResponse("긴장되는 게 당연해요. 천천히 해봐요!"))
      .mockResolvedValueOnce(relevantJudge());
    const reply = await generateGuideReply(baseCtx);
    expect(reply).toBe("긴장되는 게 당연해요. 천천히 해봐요!");
    expect(mockFetch).toHaveBeenCalledTimes(2); // 생성 1회 + 관련성 검증 1회
  });

  it("응답을 감싼 따옴표는 벗겨낸다", async () => {
    mockFetch
      .mockResolvedValueOnce(okResponse('"좋아요, 잘하고 있어요!"'))
      .mockResolvedValueOnce(relevantJudge());
    expect(await generateGuideReply(baseCtx)).toBe("좋아요, 잘하고 있어요!");
  });

  it("1차 형식 검증 실패 시 재시도하고, 재시도가 성공+관련성도 통과하면 그 응답을 쓴다 (5.5)", async () => {
    mockFetch
      .mockResolvedValueOnce(errorResponse) // 1차 생성 실패
      .mockResolvedValueOnce(okResponse("다시 생성한 응답")) // 2차 생성 성공
      .mockResolvedValueOnce(relevantJudge()); // 관련성 통과
    const reply = await generateGuideReply(baseCtx);
    expect(reply).toBe("다시 생성한 응답");
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("관련성 검증에서 걸리면 재생성하고, 재생성한 답이 관련 있으면 그걸 쓴다", async () => {
    mockFetch
      .mockResolvedValueOnce(okResponse("이런 날엔 산책하기 좋을 것 같아요")) // 1차: 형식은 OK
      .mockResolvedValueOnce(irrelevantJudge()) // 관련성 검증에서 걸림
      .mockResolvedValueOnce(okResponse("펜촉이 얇아서 필기감이 좋아요")) // 2차: 재생성
      .mockResolvedValueOnce(relevantJudge()); // 관련성 통과
    const reply = await generateGuideReply(baseCtx);
    expect(reply).toBe("펜촉이 얇아서 필기감이 좋아요");
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it("관련성 검증에서 계속 걸려도(최대 시도 소진), 형식은 맞는 마지막 응답을 반환한다", async () => {
    mockFetch
      .mockResolvedValueOnce(okResponse("응답1"))
      .mockResolvedValueOnce(irrelevantJudge())
      .mockResolvedValueOnce(okResponse("응답2"))
      .mockResolvedValueOnce(irrelevantJudge())
      .mockResolvedValueOnce(okResponse("응답3"))
      .mockResolvedValueOnce(irrelevantJudge());
    const reply = await generateGuideReply(baseCtx);
    // 완전히 무관한 정적 폴백보다는, 형식은 맞는 마지막 LLM 응답이 낫다고 보고 그걸 반환한다.
    expect(reply).toBe("응답3");
    expect(mockFetch).toHaveBeenCalledTimes(6); // 생성 3회 + 관련성 검증 3회(최대 시도)
  });

  it("관련성 검증 호출 자체가 실패하면 통과 처리한다(fail open)", async () => {
    mockFetch
      .mockResolvedValueOnce(okResponse("긴장되는 게 당연해요. 천천히 해봐요!"))
      .mockResolvedValueOnce(errorResponse); // 관련성 검증 호출 실패
    const reply = await generateGuideReply(baseCtx);
    expect(reply).toBe("긴장되는 게 당연해요. 천천히 해봐요!");
  });

  // #254 리뷰 지적 — 이전에는 "IRRELEVANT" 미포함이면 무조건 관련 있음으로 처리해,
  // judge가 UNKNOWN이나 설명형 문장 등 애매한 값을 내도 검증 없이 통과했다.
  // 정확히 RELEVANT일 때만 통과시키고, 그 외 값은 재생성으로 보낸다(호출 자체 실패와는 구분).
  it("관련성 판정이 RELEVANT/IRRELEVANT가 아닌 애매한 값이면 재생성한다", async () => {
    mockFetch
      .mockResolvedValueOnce(okResponse("이런 날엔 산책하기 좋을 것 같아요"))
      .mockResolvedValueOnce(okResponse("UNKNOWN")) // 애매한 판정값
      .mockResolvedValueOnce(okResponse("펜촉이 얇아서 필기감이 좋아요"))
      .mockResolvedValueOnce(relevantJudge());
    const reply = await generateGuideReply(baseCtx);
    expect(reply).toBe("펜촉이 얇아서 필기감이 좋아요");
  });

  it("관련성 판정이 한국어 설명형 응답이어도 재생성한다", async () => {
    mockFetch
      .mockResolvedValueOnce(okResponse("이런 날엔 산책하기 좋을 것 같아요"))
      .mockResolvedValueOnce(okResponse("이 답변은 관련이 없어 보입니다"))
      .mockResolvedValueOnce(okResponse("펜촉이 얇아서 필기감이 좋아요"))
      .mockResolvedValueOnce(relevantJudge());
    const reply = await generateGuideReply(baseCtx);
    expect(reply).toBe("펜촉이 얇아서 필기감이 좋아요");
  });

  // #254 리뷰 지적 — judge가 미션 제목·방금 발화만 보고 판정해, 배역·최근 맥락과
  // 자연스럽게 이어지는 답을 오판할 여지가 있었다. persona·미션 설명·흐름 단계·최근
  // 이력이 관련성 검증 요청에 실제로 실려 가는지 확인한다.
  it("관련성 검증 요청에 배역·미션 설명·최근 대화 맥락을 함께 담는다", async () => {
    mockFetch
      .mockResolvedValueOnce(okResponse("긴장되는 게 당연해요. 천천히 해봐요!"))
      .mockResolvedValueOnce(relevantJudge());
    await generateGuideReply(baseCtx);

    const relevanceCallBody = JSON.parse(mockFetch.mock.calls[1][1].body as string);
    const userMessage = relevanceCallBody.messages.find(
      (m: { role: string }) => m.role === "user"
    ).content;
    expect(userMessage).toContain(baseCtx.persona);
    expect(userMessage).toContain(baseCtx.missionDescription);
    expect(userMessage).toContain(baseCtx.flowStep);
    expect(userMessage).toContain("안녕하세요! 오늘 기분은 어떠세요?");
  });

  // #254 리뷰 지적 — 위 테스트는 이력이 2개뿐이라 RELEVANCE_HISTORY_MESSAGES(4) 상한이
  // 없어지거나 잘못 바뀌어도 그대로 통과한다. 5개 이상을 넣어 최신 4개만 남고
  // 더 오래된 메시지는 빠지는지 직접 확인한다.
  it("관련성 검증 요청의 최근 대화는 최신 4개만 담고 더 오래된 건 뺀다", async () => {
    const history: GuideReplyContext["history"] = [
      { role: "user", content: "가장오래된메시지" },
      { role: "guide", content: "두번째메시지" },
      { role: "user", content: "세번째메시지" },
      { role: "guide", content: "네번째메시지" },
      { role: "user", content: "다섯번째메시지" },
    ];
    mockFetch
      .mockResolvedValueOnce(okResponse("긴장되는 게 당연해요. 천천히 해봐요!"))
      .mockResolvedValueOnce(relevantJudge());
    await generateGuideReply({ ...baseCtx, history });

    const relevanceCallBody = JSON.parse(mockFetch.mock.calls[1][1].body as string);
    const userMessage = relevanceCallBody.messages.find(
      (m: { role: string }) => m.role === "user"
    ).content;
    expect(userMessage).not.toContain("가장오래된메시지");
    expect(userMessage).toContain("두번째메시지");
    expect(userMessage).toContain("세번째메시지");
    expect(userMessage).toContain("네번째메시지");
    expect(userMessage).toContain("다섯번째메시지");
  });

  it("모든 시도(생성 자체)가 실패하면 null을 반환한다 (→ 템플릿 폴백)", async () => {
    mockFetch.mockResolvedValue(errorResponse);
    const reply = await generateGuideReply(baseCtx);
    expect(reply).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(3); // 최대 시도(3회) 전부 생성 자체가 실패 — 관련성 호출은 없음
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

