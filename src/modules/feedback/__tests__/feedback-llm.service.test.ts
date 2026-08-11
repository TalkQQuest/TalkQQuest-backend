jest.mock("../../../config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../../../shared/ai/upstage.client", () => ({
  ...jest.requireActual("../../../shared/ai/upstage.client"),
  callUpstageChat: jest.fn(),
}));

import { callUpstageChat } from "../../../shared/ai/upstage.client";
import {
  buildFeedbackMessages,
  generateFeedbackWithLlm,
} from "../services/feedback-llm.service";

const mockedCall = jest.mocked(callUpstageChat);

const transcript = [
  { role: "user" as const, content: "안녕하세요! 오늘 날씨가 좋네요" },
  { role: "guide" as const, content: "그러게요, 산책하기 좋은 날씨예요" },
  { role: "user" as const, content: "혹시 이 근처 자주 오세요?" },
];

// transcript의 사용자 발화는 2건이므로 유효한 번호는 1, 2뿐이다.
const validMetric = {
  score: 90,
  strengths: ["존중하는 표현을 썼어요"],
  improvements: ["조금 더 구체적으로 칭찬해보세요"],
  bestSentenceIndex: 1,
};

const validResponse = JSON.stringify({
  kindness: validMetric,
  initiative: validMetric,
  empathy: validMetric,
  questionLink: { ...validMetric, bestSentenceIndex: 2 },
  missionSummary: ["장소 경험을 공유했어요"],
  summaryChips: ["자기성장", "첫 만남", "스몰토크"],
  conversationSummary: "카페에서 처음 만난 사람에게 먼저 인사를 건네고 날씨와 동네 이야기를 나눴습니다.",
  cardSummary: "처음 만난 사람과 인사를 나눴어요.",
  conversationHighlights: ["먼저 인사를 건넸어요", "날씨 이야기로 대화를 이어갔어요"],
  savedPhraseIndex: 1,
});

beforeEach(() => jest.clearAllMocks());

describe("buildFeedbackMessages", () => {
  it("system + user 메시지 2개를 만든다", () => {
    const messages = buildFeedbackMessages(transcript, "인사 연습", "먼저 인사해보세요");
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
  });

  it("user 메시지에 미션 정보와 대화 내용을 포함한다", () => {
    const content = buildFeedbackMessages(transcript, "인사 연습", "먼저 인사해보세요")[1].content;
    expect(content).toContain("인사 연습");
    expect(content).toContain("먼저 인사해보세요");
    expect(content).toContain("혹시 이 근처 자주 오세요?");
  });

  it("내용 없는 사용자 발화는 대화 기록과 후보 목록 양쪽에서 똑같이 제외한다", () => {
    const withBlank = [
      { role: "user" as const, content: "   " },
      ...transcript,
    ];
    const content = buildFeedbackMessages(withBlank, "인사 연습", null)[1].content;

    expect(content).toContain("사용자[1]: 안녕하세요! 오늘 날씨가 좋네요");
    expect(content).toContain("사용자[2]: 혹시 이 근처 자주 오세요?");
    expect(content).toContain("[1] 안녕하세요! 오늘 날씨가 좋네요");
    expect(content).toContain("[2] 혹시 이 근처 자주 오세요?");
    expect(content).not.toContain("사용자[3]");
  });

  it("끝쪽에 공백 발화가 몰려 있어도 유효 발화가 밀려나지 않는다", () => {
    const blanks = Array.from({ length: 60 }, () => ({ role: "user" as const, content: "  " }));
    const content = buildFeedbackMessages([...transcript, ...blanks], "인사 연습", null)[1].content;

    expect(content).toContain("[1] 안녕하세요! 오늘 날씨가 좋네요");
    expect(content).toContain("[2] 혹시 이 근처 자주 오세요?");
  });

  it("system 프롬프트에 4개 지표 정의와 JSON 형식 요구를 담는다", () => {
    const system = buildFeedbackMessages(transcript, "인사 연습", null)[0].content;
    expect(system).toContain("kindness");
    expect(system).toContain("initiative");
    expect(system).toContain("empathy");
    expect(system).toContain("questionLink");
    expect(system).toContain("JSON");
  });

  it("미션 문맥 우선순위를 metric 정의보다 먼저 제시한다", () => {
    const system = buildFeedbackMessages(transcript, "카페에서 간단히 주문하기", null)[0].content;

    expect(system.indexOf("평가 우선순위:")).toBeGreaterThanOrEqual(0);
    expect(system.indexOf("평가 우선순위:")).toBeLessThan(system.indexOf("다음 4개 지표"));
    expect(system).toContain("미션 목적과 실제 상황의 자연스러움을 우선");
    expect(system).toContain("Playbook 평가 문맥이 제공되지 않은 경우");
  });

  it("짧은 주문 수행도 initiative로 평가하고 대화 확장을 요구하지 않는다", () => {
    const system = buildFeedbackMessages(transcript, "카페에서 간단히 주문하기", null)[0].content;

    expect(system).toContain("주도성은 반드시 대화를 길게 확장하는 것을 뜻하지 않습니다");
    expect(system).toContain("먼저 인사·주문·요청하고 필요한 응답을 제공했다면");
    expect(system).toContain("대화를 더 길게 이어가라는 요구");
  });

  it("서비스 상황의 공손한 응답과 감사를 empathy의 사회적 배려로 인정한다", () => {
    const system = buildFeedbackMessages(transcript, "카페에서 간단히 주문하기", null)[0].content;

    expect(system).toContain("감정적인 공감 문장이 항상 필요한 것은 아닙니다");
    expect(system).toContain("공손한 응답, 상대 요청에 맞는 정보 제공, 감사 표현");
    expect(system).toContain("단순 주문 상황에 어울리지 않는 감정적 공감 문장");
  });

  it("questionLink를 질문이 자연스럽게 필요한 상황 안에서 평가한다", () => {
    const system = buildFeedbackMessages(transcript, "카페에서 간단히 주문하기", null)[0].content;

    expect(system).toContain("모든 대화에서 후속 질문을 요구하는 지표가 아닙니다");
    expect(system).toContain("질문하지 않은 사실 자체를 감점 근거로 사용하지 않습니다");
    expect(system).toContain("상대의 질문이나 안내에 맥락에 맞게 반응");
  });

  it("확장형 improvement에 미래 적용 조건을 요구하고 무관한 행동을 금지한다", () => {
    const system = buildFeedbackMessages(transcript, "카페에서 간단히 주문하기", null)[0].content;

    expect(system).toContain('"다음에 실제로 해당 상황이 생긴다면"처럼 적용 조건');
    expect(system).toContain("현재 미션과 무관한 행동을 새로 제안하지 않습니다");
    expect(system).toContain("추천 메뉴나 결제 방법처럼 불필요한 후속 질문");
    expect(system).toContain("이미 완료된 목적을 다시 확인하거나 반복하게 하는 발화");
  });

  it("필요하지 않았던 행동을 고득점 수단으로 제안하지 않고 다른 상황의 조건부 팁으로 제한한다", () => {
    const system = buildFeedbackMessages(transcript, "카페에서 간단히 주문하기", null)[0].content;

    expect(system).toContain("objective, successCriteria, feedbackFocus에 필요하지 않고");
    expect(system).toContain('"하면 더 높은 점수를 받을 수 있다"는 의미의 improvements로 제안하지 않습니다');
    expect(system).toContain("현재 미션을 더 길게 확장하는 행동이 아니라");
    expect(system).toContain("같은 역량이 실제로 필요한 다른 상황에서 사용할 수 있는 조건부 팁");
    expect(system).toContain("현재 미션을 다시 수행하거나 불필요하게 이어가라는 의미가 되어서는 안 됩니다");
  });

  it("질문 기회가 없는 미션에서는 questionLink 감점이나 불필요한 질문을 요구하지 않는다", () => {
    const system = buildFeedbackMessages(transcript, "카페에서 간단히 주문하기", null)[0].content;

    expect(system).toContain("합리적인 기회가 있었는지 먼저 판단");
    expect(system).toContain("질문하지 않았다는 이유만으로 questionLink를 감점");
    expect(system).toContain("불필요한 질문을 요구하지 않습니다");
    expect(system).toContain("기회 부족 자체를 낮은 수행의 근거로 삼지 않습니다");
  });

  it("실제 후속 질문 기회가 있었다면 기존 questionLink 정의로 평가한다", () => {
    const system = buildFeedbackMessages(transcript, "카페에서 간단히 주문하기", null)[0].content;

    expect(system).toContain("실제 대화에서 자연스러운 후속 질문 기회가 있었다면");
    expect(system).toContain("questionLink를 기존 정의대로 평가");
    expect(system).toContain("기회가 있었는데 놓쳤거나");
  });

  it("관찰 기회가 부족하면 억지 결함 대신 확장형 improvement를 작성한다", () => {
    const system = buildFeedbackMessages(transcript, "카페에서 간단히 주문하기", null)[0].content;

    expect(system).toContain("현재 수행의 결함을 지어내지 말고");
    expect(system).toContain("동기부여형 확장 팁을 최소 1개");
    expect(system).toContain("하지 않은 행동을 했다고 칭찬하지 않습니다");
    expect(system).toContain("그 지표를 잘 수행했다고 과장하지 않습니다");
  });

  it("Playbook 평가 메타데이터와 적용 원칙을 optional context로 주입한다", () => {
    const content = buildFeedbackMessages(transcript, "인사 연습", null, {
      objective: "낯선 사람과 자연스럽게 대화를 시작한다.",
      successCriteria: ["사용자가 먼저 인사한다."],
      feedbackFocus: ["대화를 시작하는 표현"],
    })[1].content;

    expect(content).toContain("미션 상위 목적");
    expect(content).toContain("낯선 사람과 자연스럽게 대화를 시작한다.");
    expect(content).toContain("미션 수행 기준");
    expect(content).toContain("사용자가 먼저 인사한다.");
    expect(content).toContain("미션별 피드백 관찰 포인트");
    expect(content).toContain("대화를 시작하는 표현");
    expect(content).toContain("확인할 수 없는 행동을 수행했다고 추정하지 마세요");
    expect(content).toContain("달성 여부는 주로 missionSummary에 반영하세요");
    expect(content).toContain("해당 공통 지표와 관련 있을 때만 strengths 또는 improvements");
    expect(content).toContain("기존 정의를 유지");
    expect(content).toContain("네 점수를 일괄적으로 올리거나 내리지 마세요");
    expect(content).toContain("미션 상위 목적, 미션 수행 기준, 미션별 피드백 관찰 포인트와 모순되면 안 됩니다");
    expect(content).toContain("미션을 이미 자연스럽게 완료했다면");
    expect(content).toContain("불필요한 행동을 추가로 요구하지 마세요");
  });

  it("부분 context는 존재하는 필드만 프롬프트에 넣는다", () => {
    const content = buildFeedbackMessages(transcript, "인사 연습", null, {
      feedbackFocus: ["후속 질문의 연결성"],
    })[1].content;

    expect(content).toContain("미션별 피드백 관찰 포인트");
    expect(content).toContain("후속 질문의 연결성");
    expect(content).not.toContain("미션 상위 목적(평가 항목이 아니라");
    expect(content).not.toContain("\n미션 수행 기준:\n");
  });

  it("Playbook context가 없으면 기존 title + description + transcript 프롬프트를 유지한다", () => {
    const content = buildFeedbackMessages(transcript, "인사 연습", "먼저 인사해보세요")[1].content;

    expect(content).toContain("인사 연습");
    expect(content).toContain("먼저 인사해보세요");
    expect(content).toContain("대화 기록:");
    expect(content).not.toContain("미션 상위 목적");
    expect(content).not.toContain("미션 수행 기준:");
    expect(content).not.toContain("미션별 피드백 관찰 포인트:");
  });
});

describe("generateFeedbackWithLlm", () => {
  it("정상 응답이면 4개 지표 + missionSummary + savedPhrase를 반환한다", async () => {
    mockedCall.mockResolvedValue({ ok: true, content: validResponse });

    const result = await generateFeedbackWithLlm(transcript, "인사 연습", null);

    expect(result?.metrics.kindness.score).toBe(90);
    expect(result?.missionSummary).toEqual(["장소 경험을 공유했어요"]);
    expect(result?.summaryChips).toEqual(["자기성장", "첫 만남", "스몰토크"]);
    expect(result?.conversationSummary).toContain("카페에서 처음 만난 사람");
    expect(result?.cardSummary).toBe("처음 만난 사람과 인사를 나눴어요.");
    expect(result?.conversationHighlights).toEqual([
      "먼저 인사를 건넸어요",
      "날씨 이야기로 대화를 이어갔어요",
    ]);
    expect(mockedCall).toHaveBeenCalledTimes(1);
  });

  it("번호를 실제 사용자 발화 원문으로 되돌려준다", async () => {
    mockedCall.mockResolvedValue({ ok: true, content: validResponse });

    const result = await generateFeedbackWithLlm(transcript, "인사 연습", null);

    expect(result?.metrics.kindness.bestSentence).toBe("안녕하세요! 오늘 날씨가 좋네요");
    expect(result?.metrics.questionLink.bestSentence).toBe("혹시 이 근처 자주 오세요?");
    expect(result?.savedPhrase).toBe("안녕하세요! 오늘 날씨가 좋네요");
  });

  it("strengths가 프롬프트 상한(3개)을 넘으면 거부한다", async () => {
    mockedCall.mockResolvedValue({
      ok: true,
      content: JSON.stringify({
        kindness: { ...validMetric, strengths: ["1", "2", "3", "4"] },
        initiative: validMetric,
        empathy: validMetric,
        questionLink: { ...validMetric, bestSentenceIndex: 2 },
        missionSummary: ["요약"],
        summaryChips: ["자기성장", "첫 만남", "스몰토크"],
        conversationSummary: "요약 문장입니다.",
        cardSummary: "짧은 요약입니다.",
        conversationHighlights: ["흐름1", "흐름2"],
        savedPhraseIndex: 1,
      }),
    });

    expect(await generateFeedbackWithLlm(transcript, "인사 연습", null)).toBeNull();
  });

  it.each([
    ["strengths", { strengths: [] }],
    ["improvements", { improvements: [] }],
  ])("%s는 기존처럼 최소 1개를 요구한다", async (_field, override) => {
    mockedCall.mockResolvedValue({
      ok: true,
      content: JSON.stringify({
        kindness: { ...validMetric, ...override },
        initiative: validMetric,
        empathy: validMetric,
        questionLink: { ...validMetric, bestSentenceIndex: 2 },
        missionSummary: ["요약"],
        summaryChips: ["자기성장", "첫 만남", "스몰토크"],
        conversationSummary: "요약 문장입니다.",
        savedPhraseIndex: 1,
      }),
    });

    expect(await generateFeedbackWithLlm(transcript, "인사 연습", null)).toBeNull();
  });

  it("사용자 발화 범위를 벗어난 번호를 고르면 null을 반환한다(하지 않은 말 방지)", async () => {
    mockedCall.mockResolvedValue({
      ok: true,
      content: JSON.stringify({
        kindness: validMetric,
        initiative: validMetric,
        empathy: validMetric,
        questionLink: { ...validMetric, bestSentenceIndex: 3 },
        missionSummary: ["요약"],
        summaryChips: ["자기성장", "첫 만남", "스몰토크"],
        conversationSummary: "요약 문장입니다.",
        cardSummary: "짧은 요약입니다.",
        conversationHighlights: ["흐름1", "흐름2"],
        savedPhraseIndex: 1,
      }),
    });

    expect(await generateFeedbackWithLlm(transcript, "인사 연습", null)).toBeNull();
  });

  it("savedPhraseIndex가 범위를 벗어나도 null을 반환한다", async () => {
    mockedCall.mockResolvedValue({
      ok: true,
      content: JSON.stringify({
        kindness: validMetric,
        initiative: validMetric,
        empathy: validMetric,
        questionLink: validMetric,
        missionSummary: ["요약"],
        summaryChips: ["자기성장", "첫 만남", "스몰토크"],
        conversationSummary: "요약 문장입니다.",
        cardSummary: "짧은 요약입니다.",
        conversationHighlights: ["흐름1", "흐름2"],
        savedPhraseIndex: 99,
      }),
    });

    expect(await generateFeedbackWithLlm(transcript, "인사 연습", null)).toBeNull();
  });

  it("문장을 직접 써서 보내면(구 형식) 스키마 검증에서 걸러진다", async () => {
    mockedCall.mockResolvedValue({
      ok: true,
      content: JSON.stringify({
        kindness: { ...validMetric, bestSentenceIndex: undefined, bestSentence: "오늘 어떤 음료가 인기 있어요?" },
        initiative: validMetric,
        empathy: validMetric,
        questionLink: validMetric,
        missionSummary: ["요약"],
        summaryChips: ["자기성장", "첫 만남", "스몰토크"],
        conversationSummary: "요약 문장입니다.",
        cardSummary: "짧은 요약입니다.",
        conversationHighlights: ["흐름1", "흐름2"],
        savedPhraseIndex: 1,
      }),
    });

    expect(await generateFeedbackWithLlm(transcript, "인사 연습", null)).toBeNull();
  });

  it("1차 실패 후 재시도가 성공하면 그 결과를 쓴다", async () => {
    mockedCall
      .mockResolvedValueOnce({ ok: false, reason: "http_error", status: 500 })
      .mockResolvedValueOnce({ ok: true, content: validResponse });

    const result = await generateFeedbackWithLlm(transcript, "인사 연습", null);

    expect(result).not.toBeNull();
    expect(mockedCall).toHaveBeenCalledTimes(2);
  });

  it("재시도까지 실패하면 null을 반환한다", async () => {
    mockedCall.mockResolvedValue({ ok: false, reason: "network_error" });

    const result = await generateFeedbackWithLlm(transcript, "인사 연습", null);

    expect(result).toBeNull();
    expect(mockedCall).toHaveBeenCalledTimes(2);
  });

  it("JSON이 깨져 있으면 null을 반환한다(가짜 분석을 만들지 않음)", async () => {
    mockedCall.mockResolvedValue({ ok: true, content: "이건 JSON이 아니에요" });

    expect(await generateFeedbackWithLlm(transcript, "인사 연습", null)).toBeNull();
  });

  it("스키마에 안 맞으면(지표 누락) null을 반환한다", async () => {
    mockedCall.mockResolvedValue({
      ok: true,
      content: JSON.stringify({ kindness: validMetric }),
    });

    expect(await generateFeedbackWithLlm(transcript, "인사 연습", null)).toBeNull();
  });

  it("점수가 0~100 범위를 벗어나면 null을 반환한다", async () => {
    mockedCall.mockResolvedValue({
      ok: true,
      content: JSON.stringify({
        kindness: { ...validMetric, score: 150 },
        initiative: validMetric,
        empathy: validMetric,
        questionLink: validMetric,
        missionSummary: ["요약"],
        summaryChips: ["자기성장", "첫 만남", "스몰토크"],
        conversationSummary: "요약 문장입니다.",
        cardSummary: "짧은 요약입니다.",
        conversationHighlights: ["흐름1", "흐름2"],
        savedPhraseIndex: 1,
      }),
    });

    expect(await generateFeedbackWithLlm(transcript, "인사 연습", null)).toBeNull();
  });

  it("summaryChips가 3개가 아니거나 문장(12자 초과)이면 null을 반환한다", async () => {
    mockedCall.mockResolvedValueOnce({
      ok: true,
      content: JSON.stringify({
        kindness: validMetric,
        initiative: validMetric,
        empathy: validMetric,
        questionLink: validMetric,
        missionSummary: ["요약"],
        summaryChips: ["자기성장", "첫 만남"],
        conversationSummary: "요약 문장입니다.",
        cardSummary: "짧은 요약입니다.",
        conversationHighlights: ["흐름1", "흐름2"],
        savedPhraseIndex: 1,
      }),
    });
    expect(await generateFeedbackWithLlm(transcript, "인사 연습", null)).toBeNull();

    mockedCall.mockResolvedValue({
      ok: true,
      content: JSON.stringify({
        kindness: validMetric,
        initiative: validMetric,
        empathy: validMetric,
        questionLink: validMetric,
        missionSummary: ["요약"],
        summaryChips: ["자기성장", "첫 만남", "오늘 처음 만난 사람과 즐겁게 대화했어요"],
        conversationSummary: "요약 문장입니다.",
        cardSummary: "짧은 요약입니다.",
        conversationHighlights: ["흐름1", "흐름2"],
        savedPhraseIndex: 1,
      }),
    });
    expect(await generateFeedbackWithLlm(transcript, "인사 연습", null)).toBeNull();
  });

  it("```json 코드펜스로 감싼 응답도 파싱한다", async () => {
    mockedCall.mockResolvedValue({ ok: true, content: "```json\n" + validResponse + "\n```" });

    const result = await generateFeedbackWithLlm(transcript, "인사 연습", null);
    expect(result).not.toBeNull();
  });
});