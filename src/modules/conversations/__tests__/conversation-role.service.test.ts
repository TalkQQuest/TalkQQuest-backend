jest.mock("../../../config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../../../shared/ai", () => ({
  ...jest.requireActual("../../../shared/ai"),
  callUpstageChat: jest.fn(),
}));

import { callUpstageChat } from "../../../shared/ai";
import { generateRoleSetup } from "../services/conversation-role.service";

const mockedCall = jest.mocked(callUpstageChat);

beforeEach(() => jest.clearAllMocks());

const missionSetup = (partnerRole: "friend" | "senior" | "junior" | "peer" | "other") => ({
  environment: "community" as const,
  partnerRole,
  partnerGender: "female" as const,
  partnerAgeGroup: "fifties" as const,
  intimacyLevel: 1,
  formalityLevel: 5,
});

// #250 — persona가 AI 자신의 배역만 서술하고 "사용자를 어떻게 대해야 하는지"는 명시하지
// 않아서, 사용자가 먼저 쓴 호칭을 LLM이 그대로 반사해 역할이 뒤바뀌는 사례가 있었다.
// 구조화된 partnerRole에서 결정적으로 방향 문구를 만들어 persona에 덧붙여야 한다.
describe("generateRoleSetup — 상대 역할 방향 명시(#250)", () => {
  it("missionSetup이 있으면 partnerRole 기준 방향 문구를 persona에 덧붙인다", async () => {
    mockedCall.mockResolvedValue({
      ok: true,
      content: JSON.stringify({ persona: "동아리 1년차 선배, 친근한 존댓말", userTask: "질문하기" }),
    });

    const result = await generateRoleSetup("미션", null, missionSetup("senior"));

    expect(result.persona).toContain("동아리 1년차 선배, 친근한 존댓말");
    expect(result.persona).toContain("사용자는 당신의 후배입니다");
  });

  it("partnerRole별로 서로 다른(반대) 방향 문구가 붙는다", async () => {
    mockedCall.mockResolvedValue({
      ok: true,
      content: JSON.stringify({ persona: "배역", userTask: "과제" }),
    });

    const senior = await generateRoleSetup("미션", null, missionSetup("senior"));
    const junior = await generateRoleSetup("미션", null, missionSetup("junior"));

    expect(senior.persona).toContain("사용자는 당신의 후배입니다");
    expect(junior.persona).toContain("사용자는 당신의 선배입니다");
  });

  // 코드래빗 리뷰 — senior/junior만 검증하고 있어 friend/peer/other 방향 문구는
  // 회귀 방지가 안 되고 있었다. 5개 역할 전부를 각자 기대 문구로 검증한다.
  it.each([
    ["friend", "사용자는 당신의 친구입니다"],
    ["senior", "사용자는 당신의 후배입니다"],
    ["junior", "사용자는 당신의 선배입니다"],
    ["peer", "사용자는 당신과 동기·동료 관계입니다"],
    ["other", "사용자는 당신과 초면이거나 가벼운 친분이 있는 사이입니다"],
  ] as const)("partnerRole=%s이면 '%s' 문구가 persona에 포함된다", async (role, expectedPhrase) => {
    mockedCall.mockResolvedValue({
      ok: true,
      content: JSON.stringify({ persona: "배역", userTask: "과제" }),
    });

    const result = await generateRoleSetup("미션", null, missionSetup(role));

    expect(result.persona).toContain(expectedPhrase);
  });

  // 코드래빗 리뷰 — persona(LLM 최대 100자) + 방향 문구를 합친 최종 길이가
  // Conversations.persona 컬럼(VARCHAR(255)) 한도를 넘지 않는지 확인한다.
  it("persona가 최대 길이여도 합친 결과가 255자를 넘지 않는다", async () => {
    const maxLengthPersona = "가".repeat(100);
    mockedCall.mockResolvedValue({
      ok: true,
      content: JSON.stringify({ persona: maxLengthPersona, userTask: "과제" }),
    });

    const result = await generateRoleSetup("미션", null, missionSetup("senior"));

    expect(result.persona).not.toBeNull();
    expect(result.persona!.length).toBeLessThanOrEqual(255);
  });

  it("missionSetup이 없으면 방향 문구를 붙이지 않는다(기존 동작 유지)", async () => {
    mockedCall.mockResolvedValue({
      ok: true,
      content: JSON.stringify({ persona: "카페 사장님, 친절한 존댓말", userTask: "질문하기" }),
    });

    const result = await generateRoleSetup("미션", null, null);

    expect(result.persona).toBe("카페 사장님, 친절한 존댓말");
  });

  it("LLM 호출이 실패하면 persona가 null이라 방향 문구도 붙지 않는다", async () => {
    mockedCall.mockResolvedValue({ ok: false, reason: "timeout" });

    const result = await generateRoleSetup("미션", null, missionSetup("senior"));

    expect(result).toEqual({ persona: null, userTask: null });
  });
});
