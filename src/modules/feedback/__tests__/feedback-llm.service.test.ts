jest.mock("../../../config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../../../shared/llm/upstage", () => ({
  ...jest.requireActual("../../../shared/llm/upstage"),
  callUpstageChat: jest.fn(),
}));

import { callUpstageChat } from "../../../shared/llm/upstage";
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

  it("system 프롬프트에 4개 지표 정의와 JSON 형식 요구를 담는다", () => {
    const system = buildFeedbackMessages(transcript, "인사 연습", null)[0].content;
    expect(system).toContain("kindness");
    expect(system).toContain("initiative");
    expect(system).toContain("empathy");
    expect(system).toContain("questionLink");
    expect(system).toContain("JSON");
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
    expect(mockedCall).toHaveBeenCalledTimes(1);
  });

  it("번호를 실제 사용자 발화 원문으로 되돌려준다", async () => {
    mockedCall.mockResolvedValue({ ok: true, content: validResponse });

    const result = await generateFeedbackWithLlm(transcript, "인사 연습", null);

    // 1번 = 첫 번째 사용자 발화, 2번 = 두 번째 사용자 발화 (guide 발화는 번호에서 제외된다)
    expect(result?.metrics.kindness.bestSentence).toBe("안녕하세요! 오늘 날씨가 좋네요");
    expect(result?.metrics.questionLink.bestSentence).toBe("혹시 이 근처 자주 오세요?");
    expect(result?.savedPhrase).toBe("안녕하세요! 오늘 날씨가 좋네요");
  });

  it("사용자 발화 범위를 벗어난 번호를 고르면 null을 반환한다(하지 않은 말 방지)", async () => {
    // 사용자 발화는 2건인데 3번을 고른 경우 = 지어낸 문장
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
      content: JSON.stringify({ kindness: validMetric }), // 나머지 3개 지표 누락
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
        savedPhraseIndex: 1,
      }),
    });

    expect(await generateFeedbackWithLlm(transcript, "인사 연습", null)).toBeNull();
  });

  it("summaryChips가 3개가 아니거나 문장(12자 초과)이면 null을 반환한다", async () => {
    // 2개(부족)
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
        savedPhraseIndex: 1,
      }),
    });
    expect(await generateFeedbackWithLlm(transcript, "인사 연습", null)).toBeNull();

    // 문장형(12자 초과) — 단어 포맷 위반
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
