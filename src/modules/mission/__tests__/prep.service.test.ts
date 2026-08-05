import { callUpstageChat } from "../../../shared/ai";
import {
  generateStarters,
  pickRandomStarters,
  STARTER_DISPLAY_COUNT,
  STARTER_POOL_SIZE,
} from "../services/prep.service";

// 줄 파싱(parseLineList) 등 나머지 유틸은 실제 구현을 그대로 쓰고 LLM 호출만 가로챈다.
jest.mock("../../../shared/ai", () => ({
  ...jest.requireActual("../../../shared/ai"),
  callUpstageChat: jest.fn(),
}));

const mockedChat = jest.mocked(callUpstageChat);

const chatOk = (content: string) => ({ ok: true as const, content });

// 유효한 첫 마디 n개를 줄바꿈으로 이어 붙인 응답.
const starterLines = (count: number) =>
  Array.from({ length: count }, (_, i) => `${i}번째 상황에 맞는 첫 마디를 건네볼까요?`).join("\n");

beforeEach(() => {
  jest.clearAllMocks();
});

describe("generateStarters", () => {
  it("후보를 풀 크기만큼 뽑아 돌려준다", async () => {
    mockedChat.mockResolvedValue(chatOk(starterLines(STARTER_POOL_SIZE)));

    const result = await generateStarters("카페에서 음료 추천 물어보기", null);

    expect(result).toHaveLength(STARTER_POOL_SIZE);
  });

  it("표시 개수를 못 채우면 null을 돌려준다", async () => {
    // 미션당 1회만 생성해 그대로 굳으므로, 부족한 결과를 저장하면 그 미션은
    // 계속 3개 미만으로 노출된다. 저장하지 않고 호출부 폴백으로 넘긴다.
    mockedChat.mockResolvedValue(chatOk(starterLines(STARTER_DISPLAY_COUNT - 1)));

    expect(await generateStarters("카페에서 음료 추천 물어보기", null)).toBeNull();
  });

  it("LLM 호출이 실패하면 null을 돌려준다", async () => {
    mockedChat.mockResolvedValue({ ok: false, reason: "timeout" });

    expect(await generateStarters("카페에서 음료 추천 물어보기", null)).toBeNull();
  });
});

describe("pickRandomStarters", () => {
  it("표시 개수만큼 고르고 중복 없이 돌려준다", () => {
    const pool = Array.from({ length: STARTER_POOL_SIZE }, (_, i) => `문장 ${i}`);

    const picked = pickRandomStarters(pool);

    expect(picked).toHaveLength(STARTER_DISPLAY_COUNT);
    expect(new Set(picked).size).toBe(STARTER_DISPLAY_COUNT);
    picked.forEach((sentence) => expect(pool).toContain(sentence));
  });

  it("원본 배열을 바꾸지 않는다", () => {
    const pool = ["a", "b", "c", "d"];
    const snapshot = [...pool];

    pickRandomStarters(pool);

    expect(pool).toEqual(snapshot);
  });
});
