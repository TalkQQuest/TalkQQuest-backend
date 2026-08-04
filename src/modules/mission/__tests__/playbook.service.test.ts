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
  advanceFlow,
  generatePlaybook,
  matchResponseRules,
  parseStoredPlaybook,
  FLOW_ADVANCE_MARGIN,
  MAX_INJECTED_RULES,
  MAX_TURNS_PER_STEP,
  RULE_MATCH_THRESHOLD,
} from "../services/playbook.service";

const mockedChat = jest.mocked(callUpstageChat);
const mockedEmbed = jest.mocked(callUpstageEmbedding);

// LLM이 만들어내는 형식(임베딩 없음). 흐름 단계마다 "사용자가 무엇을 하면 통과인지"를 함께 준다.
const generated = {
  flow: [
    { step: "도입: 가볍게 근황 묻기", advanceExamples: ["안녕하세요", "여기 처음 와봐요"] },
    { step: "전개: 이야기 듣고 되묻기", advanceExamples: ["저는 등산을 좋아해요", "작년에 여행 갔었어요"] },
    { step: "마무리: 공감하며 정리", advanceExamples: ["오늘 즐거웠어요", "다음에 또 봐요"] },
  ],
  responseRules: [
    { when: "무슨 말을 해야 할지 모르겠다고 함", then: "선택지를 좁혀 하나만 물어보기" },
    { when: "사용자가 과제를 이미 수행함", then: "구체적인 지점을 짚어 반응하고 마무리로" },
  ],
};

// 저장된 형태(임베딩 포함). 유사도를 손으로 계산할 수 있게 2차원으로 둔다.
// stepVectors[i] = i단계 예시들의 임베딩 목록
const stored = (ruleVectors: number[][], stepVectors: number[][][] = []) => ({
  flow: generated.flow.map((step, i) => ({
    ...step,
    ...(stepVectors[i] ? { advanceEmbeddings: stepVectors[i] } : {}),
  })),
  responseRules: generated.responseRules.map((rule, i) => ({
    ...rule,
    ...(ruleVectors[i] ? { whenEmbedding: ruleVectors[i] } : {}),
  })),
});

beforeEach(() => jest.clearAllMocks());

describe("generatePlaybook", () => {
  it("규칙 when과 단계 예시 발화를 한 번의 호출로 임베딩해 붙인다", async () => {
    mockedChat.mockResolvedValue({ ok: true, content: JSON.stringify(generated) });
    mockedEmbed.mockResolvedValue({
      ok: true,
      embeddings: [[1, 0], [0, 1], [1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6]],
    });

    const result = await generatePlaybook("영화 감상 공유", "인상 깊은 장면을 설명해 보세요.");

    expect(result?.flow).toHaveLength(3);
    expect(result?.responseRules[0].whenEmbedding).toEqual([1, 0]);
    // 규칙 2개 뒤에 단계별 예시가 순서대로 온다(단계마다 2개씩).
    expect(result?.flow[0].advanceEmbeddings).toEqual([[1, 1], [2, 2]]);
    expect(result?.flow[1].advanceEmbeddings).toEqual([[3, 3], [4, 4]]);
    // 저장용은 passage 모델이어야 질의(query)와 유사도가 제대로 나온다(비대칭 검색).
    expect(mockedEmbed).toHaveBeenCalledWith(
      [
        "무슨 말을 해야 할지 모르겠다고 함",
        "사용자가 과제를 이미 수행함",
        "안녕하세요", "여기 처음 와봐요",
        "저는 등산을 좋아해요", "작년에 여행 갔었어요",
        "오늘 즐거웠어요", "다음에 또 봐요",
      ],
      "passage"
    );
    expect(mockedEmbed).toHaveBeenCalledTimes(1);
  });

  it("임베딩이 실패해도 플레이북 자체는 살린다(단계는 턴 수로 넘어감)", async () => {
    mockedChat.mockResolvedValue({ ok: true, content: JSON.stringify(generated) });
    mockedEmbed.mockResolvedValue({ ok: false, reason: "network_error" });

    const result = await generatePlaybook("영화 감상 공유", null);

    expect(result?.flow).toHaveLength(3);
    expect(result?.flow[0].advanceEmbeddings).toBeUndefined();
    expect(result?.responseRules[0].whenEmbedding).toBeUndefined();
  });

  it("흐름이 3단계가 아니면 형식 위반으로 버린다", async () => {
    mockedChat.mockResolvedValue({
      ok: true,
      content: JSON.stringify({
        ...generated,
        flow: [{ step: "하나뿐", advanceExamples: ["예시1", "예시2"] }],
      }),
    });

    expect(await generatePlaybook("미션", null)).toBeNull();
    expect(mockedEmbed).not.toHaveBeenCalled();
  });

  it("advanceExamples가 빠지거나 1개뿐이면 형식 위반으로 버린다", async () => {
    mockedChat.mockResolvedValue({
      ok: true,
      content: JSON.stringify({
        ...generated,
        flow: generated.flow.map(({ step }) => ({ step, advanceExamples: ["하나뿐"] })),
      }),
    });

    expect(await generatePlaybook("미션", null)).toBeNull();
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
    expect(parseStoredPlaybook(stored([[1, 0]], [[[0, 1]]]))?.flow).toHaveLength(3);
  });

  it("null/형식 위반은 null로 처리한다", () => {
    expect(parseStoredPlaybook(null)).toBeNull();
    expect(parseStoredPlaybook({ unexpected: "shape" })).toBeNull();
  });

  it("구 형식(flow가 문자열 배열)은 통과시키지 않는다 — 다음 대화에서 재생성된다", () => {
    expect(parseStoredPlaybook({ flow: ["도입", "전개", "마무리"], responseRules: [] })).toBeNull();
  });
});

describe("matchResponseRules", () => {
  it("의미가 가까운 규칙만 유사도 순으로 고른다", () => {
    // 질의 [1,0]에 대해 규칙1은 유사도 1, 규칙2는 0 → 규칙1만 임계값을 넘는다.
    const matched = matchResponseRules(stored([[1, 0], [0, 1]]), [1, 0]);

    expect(matched).toHaveLength(1);
    expect(matched[0].when).toBe("무슨 말을 해야 할지 모르겠다고 함");
  });

  it("임계값을 넘는 규칙이 없으면 빈 배열", () => {
    expect(matchResponseRules(stored([[1, 0], [1, 0]]), [0, 1])).toEqual([]);
  });

  it(`한 번에 최대 ${MAX_INJECTED_RULES}개까지만 넣는다(토큰 보호)`, () => {
    const many = {
      flow: generated.flow,
      responseRules: [1, 2, 3].map((n) => ({
        when: `상황${n}`,
        then: `대응${n}`,
        whenEmbedding: [1, 0],
      })),
    };

    expect(matchResponseRules(many, [1, 0])).toHaveLength(MAX_INJECTED_RULES);
  });

  it("임베딩이 없는 규칙(임베딩 실패분)은 매칭 대상에서 제외한다", () => {
    expect(matchResponseRules(stored([]), [1, 0])).toEqual([]);
  });

  it("임계값 위는 넣고 아래는 버린다", () => {
    // 경계값 동일성(=== 임계값)은 부동소수점상 보장되지 않아 확실히 위/아래인 값으로 검증한다.
    const below = Math.acos(RULE_MATCH_THRESHOLD) + 0.2;
    const matched = matchResponseRules(
      stored([[1, 0], [Math.cos(below), Math.sin(below)]]),
      [1, 0]
    );

    expect(matched).toHaveLength(1);
    expect(matched[0].score).toBeGreaterThan(RULE_MATCH_THRESHOLD);
  });
});

describe("advanceFlow", () => {
  // 절대 유사도가 아니라 **단계 간 상대 비교**로 판정한다.
  // 0단계 예시는 [1,0] 방향, 1단계는 [0,1] 방향, 2단계는 [-1,0] 방향.
  const playbook = stored([], [[[1, 0]], [[0, 1]], [[-1, 0]]]);

  it("다음 단계가 현재 단계보다 가까우면 진행한다", () => {
    // 질의 [0,1] → 0단계 점수 0, 1단계 점수 1 → 진행
    const p = advanceFlow(playbook, 0, 0, [0, 1]);

    expect(p.stepIndex).toBe(1);
    expect(p.step).toBe("전개: 이야기 듣고 되묻기");
    expect(p.advanced).toBe(true);
  });

  it("현재 단계가 더 가까우면 머문다(아직 연습 중)", () => {
    const p = advanceFlow(playbook, 0, 0, [1, 0]);

    expect(p.stepIndex).toBe(0);
    expect(p.advanced).toBe(false);
  });

  it(`차이가 margin(${FLOW_ADVANCE_MARGIN}) 이하면 머문다(조기 진행 방지)`, () => {
    // 두 단계 점수가 거의 같도록 45도 방향 질의를 준다.
    const tie = [Math.SQRT1_2, Math.SQRT1_2];

    expect(advanceFlow(playbook, 0, 0, tie).advanced).toBe(false);
  });

  it(`조건에 안 걸려도 ${MAX_TURNS_PER_STEP}턴을 넘기면 올린다(갇힘 방지)`, () => {
    const p = advanceFlow(playbook, 0, MAX_TURNS_PER_STEP, [1, 0]);

    expect(p.stepIndex).toBe(1);
    expect(p.advanced).toBe(true);
  });

  it("턴 상한은 단계마다 새로 적용된다(한 번 넘겼다고 연달아 밀리지 않는다)", () => {
    // 누적 5턴이면 0단계 상한(4)은 넘겼지만 1단계 상한(8)에는 못 미친다.
    expect(advanceFlow(playbook, 0, 5, [1, 0]).advanced).toBe(true);
    expect(advanceFlow(playbook, 1, 5, [0, 1]).advanced).toBe(false);
    expect(advanceFlow(playbook, 1, 8, [0, 1]).advanced).toBe(true);
  });

  it("마지막 단계에서는 더 올리지 않는다", () => {
    const p = advanceFlow(playbook, 2, 99, [0, 1]);

    expect(p.stepIndex).toBe(2);
    expect(p.step).toBe("마무리: 공감하며 정리");
    expect(p.advanced).toBe(false);
  });

  it("임베딩이 실패해(null) 판정할 수 없어도 턴 상한으로는 진행한다", () => {
    expect(advanceFlow(playbook, 0, 0, null).advanced).toBe(false);
    expect(advanceFlow(playbook, 0, MAX_TURNS_PER_STEP, null).advanced).toBe(true);
  });

  it("단계에 예시 임베딩이 없으면 턴 상한으로만 진행한다", () => {
    const noEmbeddings = stored([], []);

    expect(advanceFlow(noEmbeddings, 0, 0, [1, 0]).advanced).toBe(false);
    expect(advanceFlow(noEmbeddings, 0, MAX_TURNS_PER_STEP, [1, 0]).advanced).toBe(true);
  });

  it("플레이북이 없으면 흐름 지침 없이 진행한다", () => {
    const p = advanceFlow(null, 0, 0, [1, 0]);

    expect(p.step).toBeNull();
    expect(p.advanced).toBe(false);
  });

  it("저장된 인덱스가 범위를 벗어나도 안전하게 다룬다", () => {
    expect(advanceFlow(playbook, 99, 0, [0, 1]).stepIndex).toBe(2);
    expect(advanceFlow(playbook, -1, 0, [0, 1]).stepIndex).toBe(1);
  });
});
