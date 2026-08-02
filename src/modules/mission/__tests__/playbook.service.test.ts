jest.mock("../../../config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../../../shared/ai/upstage.client", () => ({
  ...jest.requireActual("../../../shared/ai/upstage.client"),
  callUpstageChat: jest.fn(),
  callUpstageEmbedding: jest.fn(),
}));

import { callUpstageChat, callUpstageEmbedding } from "../../../shared/ai/upstage.client";
import {
  generatePlaybook,
  matchResponseRules,
  parseStoredPlaybook,
  MAX_INJECTED_RULES,
  RULE_MATCH_THRESHOLD,
} from "../services/playbook.service";

const mockedChat = jest.mocked(callUpstageChat);
const mockedEmbed = jest.mocked(callUpstageEmbedding);

const validPlaybook = {
  flow: ["도입: 가볍게 근황 묻기", "전개: 사용자의 이야기 듣고 되묻기", "마무리: 공감하며 정리"],
  responseRules: [
    { when: "무슨 말을 해야 할지 모르겠다고 함", then: "선택지를 좁혀 하나만 물어보기" },
    { when: "사용자가 과제를 이미 수행함", then: "구체적인 지점을 짚어 반응하고 마무리로" },
  ],
};

// 임베딩 차원을 작게 잡아 유사도를 손으로 계산할 수 있게 한다.
const embedding = (vec: number[]) => vec;

beforeEach(() => jest.clearAllMocks());

describe("generatePlaybook", () => {
  it("정상 응답이면 흐름과 규칙을 반환하고 when에 임베딩을 붙인다", async () => {
    mockedChat.mockResolvedValue({ ok: true, content: JSON.stringify(validPlaybook) });
    mockedEmbed.mockResolvedValue({ ok: true, embeddings: [embedding([1, 0]), embedding([0, 1])] });

    const result = await generatePlaybook("영화 감상 공유", "인상 깊은 장면을 설명해 보세요.");

    expect(result?.flow).toHaveLength(3);
    expect(result?.responseRules[0].whenEmbedding).toEqual([1, 0]);
    // 저장용은 passage 모델로 임베딩해야 질의(query)와 유사도가 제대로 나온다.
    expect(mockedEmbed).toHaveBeenCalledWith(
      ["무슨 말을 해야 할지 모르겠다고 함", "사용자가 과제를 이미 수행함"],
      "passage"
    );
  });

  it("임베딩이 실패해도 플레이북 자체는 살린다(흐름은 여전히 유용)", async () => {
    mockedChat.mockResolvedValue({ ok: true, content: JSON.stringify(validPlaybook) });
    mockedEmbed.mockResolvedValue({ ok: false, reason: "network_error" });

    const result = await generatePlaybook("영화 감상 공유", null);

    expect(result?.flow).toHaveLength(3);
    expect(result?.responseRules[0].whenEmbedding).toBeUndefined();
  });

  it("흐름이 3단계가 아니면 형식 위반으로 버린다", async () => {
    mockedChat.mockResolvedValue({
      ok: true,
      content: JSON.stringify({ ...validPlaybook, flow: ["하나뿐"] }),
    });

    expect(await generatePlaybook("미션", null)).toBeNull();
    expect(mockedEmbed).not.toHaveBeenCalled();
  });

  it("LLM 호출이 실패하면 null (플레이북 없이 진행)", async () => {
    mockedChat.mockResolvedValue({ ok: false, reason: "no_api_key" });

    expect(await generatePlaybook("미션", null)).toBeNull();
  });

  it("JSON이 깨져 있으면 null", async () => {
    mockedChat.mockResolvedValue({ ok: true, content: "이건 JSON이 아니에요" });

    expect(await generatePlaybook("미션", null)).toBeNull();
  });
});

describe("parseStoredPlaybook", () => {
  it("정상 형식을 통과시킨다", () => {
    expect(parseStoredPlaybook(validPlaybook)?.flow).toHaveLength(3);
  });

  it("null/형식 위반은 null로 처리한다(구 미션 대응)", () => {
    expect(parseStoredPlaybook(null)).toBeNull();
    expect(parseStoredPlaybook({ unexpected: "shape" })).toBeNull();
  });
});

describe("matchResponseRules", () => {
  const playbookWith = (vectors: number[][]) => ({
    flow: validPlaybook.flow,
    responseRules: validPlaybook.responseRules.map((rule, i) => ({
      ...rule,
      whenEmbedding: vectors[i],
    })),
  });

  it("의미가 가까운 규칙만 유사도 순으로 고른다", async () => {
    // 질의 [1,0]에 대해 규칙1은 유사도 1, 규칙2는 0 → 규칙1만 임계값을 넘는다.
    mockedEmbed.mockResolvedValue({ ok: true, embeddings: [[1, 0]] });

    const matched = await matchResponseRules(playbookWith([[1, 0], [0, 1]]), "뭐라고 해야 할지 모르겠어");

    expect(matched).toHaveLength(1);
    expect(matched[0].when).toBe("무슨 말을 해야 할지 모르겠다고 함");
    // 사용자 발화는 query 모델로 임베딩해야 한다(비대칭 검색).
    expect(mockedEmbed).toHaveBeenCalledWith(["뭐라고 해야 할지 모르겠어"], "query");
  });

  it("임계값을 넘는 규칙이 없으면 빈 배열", async () => {
    mockedEmbed.mockResolvedValue({ ok: true, embeddings: [[0, 1]] });

    const matched = await matchResponseRules(playbookWith([[1, 0], [1, 0]]), "관련 없는 말");

    expect(matched).toEqual([]);
  });

  it(`한 번에 최대 ${MAX_INJECTED_RULES}개까지만 넣는다(토큰 보호)`, async () => {
    mockedEmbed.mockResolvedValue({ ok: true, embeddings: [[1, 0]] });

    // 규칙 3개가 모두 임계값을 넘도록 같은 방향 벡터를 준다.
    const many = {
      flow: validPlaybook.flow,
      responseRules: [1, 2, 3].map((n) => ({
        when: `상황${n}`,
        then: `대응${n}`,
        whenEmbedding: [1, 0],
      })),
    };
    const matched = await matchResponseRules(many, "아무 말");

    expect(matched).toHaveLength(MAX_INJECTED_RULES);
  });

  it("임베딩이 없는 규칙(임베딩 실패분)은 매칭 대상에서 제외한다", async () => {
    const noEmbeddings = {
      flow: validPlaybook.flow,
      responseRules: validPlaybook.responseRules.map((rule) => ({ ...rule })),
    };

    expect(await matchResponseRules(noEmbeddings, "아무 말")).toEqual([]);
    expect(mockedEmbed).not.toHaveBeenCalled(); // 후보가 없으면 임베딩 호출도 생략
  });

  it("사용자 발화 임베딩이 실패하면 매칭을 생략한다(흐름만 주입)", async () => {
    mockedEmbed.mockResolvedValue({ ok: false, reason: "timeout" });

    expect(await matchResponseRules(playbookWith([[1, 0], [0, 1]]), "아무 말")).toEqual([]);
  });

  it("임계값 위는 넣고 아래는 버린다", async () => {
    // 질의 [1,0] 기준으로 규칙1은 유사도 1(확실히 위), 규칙2는 임계값보다 확실히 아래가 되도록
    // 각도를 잡는다. 경계값 동일성(=== 임계값)은 부동소수점상 보장되지 않아 검증하지 않는다.
    const belowAngle = Math.acos(RULE_MATCH_THRESHOLD) + 0.2;
    mockedEmbed.mockResolvedValue({ ok: true, embeddings: [[1, 0]] });

    const matched = await matchResponseRules(
      playbookWith([
        [1, 0],
        [Math.cos(belowAngle), Math.sin(belowAngle)],
      ]),
      "질의"
    );

    expect(matched).toHaveLength(1);
    expect(matched[0].when).toBe(validPlaybook.responseRules[0].when);
    expect(matched[0].score).toBeGreaterThan(RULE_MATCH_THRESHOLD);
  });
});
