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
});
