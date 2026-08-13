jest.mock("../../../config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
// 줄 파싱 등 나머지 유틸은 실제 구현을 쓰고 LLM 호출만 가로챈다.
jest.mock("../../../shared/ai", () => ({
  ...jest.requireActual("../../../shared/ai"),
  callUpstageChat: jest.fn(),
}));

import { callUpstageChat } from "../../../shared/ai";
import {
  buildSuggestionMessages,
  generateSuggestions,
  SuggestionContext,
} from "../services/conversation-suggestion.service";

const mockedCall = jest.mocked(callUpstageChat);

const ctx: SuggestionContext = {
  missionTitle: "카페에서 음료 추천 물어보기",
  missionDescription: null,
  history: [{ role: "user", content: "안녕하세요" }],
};

beforeEach(() => jest.clearAllMocks());

describe("generateSuggestions", () => {
  it("유효한 문장 3개를 그대로 돌려준다", async () => {
    mockedCall.mockResolvedValue({
      ok: true,
      content: ["오늘 어떤 음료가 인기 있어요?", "달지 않은 걸로 추천해주실 수 있나요?", "따뜻한 것도 있나요?"].join(
        "\n"
      ),
    });

    expect(await generateSuggestions(ctx)).toEqual([
      "오늘 어떤 음료가 인기 있어요?",
      "달지 않은 걸로 추천해주실 수 있나요?",
      "따뜻한 것도 있나요?",
    ]);
  });

  it("형식 검증에 걸려 개수를 못 채우면 null을 돌려준다", async () => {
    // 화면은 3개를 기대한다. 부족한 상태로 내보내면 호출부의 템플릿 폴백을 건너뛴다.
    mockedCall.mockResolvedValue({
      ok: true,
      content: [
        "오늘 어떤 음료가 인기 있어요?",
        "**추천해주세요**", // 마크다운 → 버려짐
        "(사용자가 음료를 물어보는 상황을 가정합니다)", // 해설 괄호 → 버려짐
      ].join("\n"),
    });

    expect(await generateSuggestions(ctx)).toBeNull();
  });

  it("LLM 호출이 실패하면 null을 돌려준다", async () => {
    mockedCall.mockResolvedValue({ ok: false, reason: "timeout" });

    expect(await generateSuggestions(ctx)).toBeNull();
  });

  // #222 — "오늘 특별히 사과 시나몬 라떼가 한정으로 나왔어" 같은 상대(점원) 역할 대사가
  // 추천 답변에 섞여 나와, 그대로 눌러 보내면 role: user로 저장되던 문제.
  it("상대 역할(점원 등)의 안내·판매 대사는 걸러내고, 부족하면 null을 돌려준다", async () => {
    mockedCall.mockResolvedValue({
      ok: true,
      content: [
        "오늘 특별히 사과 시나몬 라떼가 한정으로 나왔어",
        "시원한 아이스 멜론 주스도 시즌 메뉴로 준비했어요",
        "그럼 아이스 아메리카노로 주세요",
      ].join("\n"),
    });

    // 3개 중 2개가 상대 역할 대사라 걸러지고 1개만 남는다 — 개수를 못 채우면 폴백에 맡긴다.
    expect(await generateSuggestions(ctx)).toBeNull();
  });

  it("상대 역할 대사가 하나도 없으면 그대로 3개를 반환한다(오탐 없음 확인)", async () => {
    mockedCall.mockResolvedValue({
      ok: true,
      content: [
        "그럼 아이스 아메리카노로 주세요",
        "혹시 시즌 메뉴 있나요?",
        "저는 단 거 별로 안 좋아해요",
      ].join("\n"),
    });

    expect(await generateSuggestions(ctx)).toEqual([
      "그럼 아이스 아메리카노로 주세요",
      "혹시 시즌 메뉴 있나요?",
      "저는 단 거 별로 안 좋아해요",
    ]);
  });
});

describe("buildSuggestionMessages — 프롬프트에 역할 이탈 금지 규칙 포함(#222)", () => {
  it("상대 역할 대사를 만들지 말라는 규칙이 시스템 프롬프트에 포함된다", () => {
    const messages = buildSuggestionMessages(ctx);
    const systemMessage = messages.find((m) => m.role === "system");

    expect(systemMessage?.content).toContain("상대 역할");
  });
});
