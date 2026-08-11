jest.mock("../../../config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../../../shared/ai/upstage.client", () => ({
  ...jest.requireActual("../../../shared/ai/upstage.client"),
  callUpstageChat: jest.fn(),
  callUpstageEmbedding: jest.fn(),
}));

import { callUpstageChat, callUpstageEmbedding } from "../../../shared/ai/upstage.client";
import { logger } from "../../../config/logger";
import {
  advanceFlow,
  buildPlaybookMessages,
  findPlaybookObservabilityViolation,
  findPlaybookQuantitativeConstraintViolation,
  generatePlaybook,
  matchResponseRules,
  parseStoredPlaybook,
  FLOW_ADVANCE_MARGIN,
  MAX_INJECTED_RULES,
  MAX_TURNS_PER_STEP,
  RULE_MATCH_THRESHOLD,
  toPlaybookMissionContext,
} from "../services/playbook.service";

const mockedChat = jest.mocked(callUpstageChat);
const mockedEmbed = jest.mocked(callUpstageEmbedding);
const mockedWarn = jest.mocked(logger.warn);

const missionContext = {
  title: "영화 감상 공유",
  description: "인상 깊은 장면을 설명해 보세요.",
  category: "감상 공유",
  difficulty: 2,
  tags: ["영화", "감정 표현"],
};

// LLM이 만들어내는 형식(임베딩 없음). 흐름 단계마다 "사용자가 무엇을 하면 통과인지"를 함께 준다.
const generated = {
  objective: "사용자가 인상 깊은 영화 장면과 느낀 점을 직접 설명한다.",
  successCriteria: ["사용자가 장면을 구체적으로 묘사한다.", "느낀 점을 한 문장 이상 말한다."],
  feedbackFocus: ["장면 설명의 구체성", "감정 표현 여부"],
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

    const result = await generatePlaybook(missionContext);

    expect(result?.flow).toHaveLength(3);
    expect(result?.responseRules[0].whenEmbedding).toEqual([1, 0]);
    // 규칙 2개 뒤에 단계별 예시가 순서대로 온다(단계마다 2개씩).
    expect(result?.flow[0].advanceEmbeddings).toEqual([[1, 1], [2, 2]]);
    expect(result?.flow[1].advanceEmbeddings).toEqual([[3, 3], [4, 4]]);
    expect(result).toMatchObject({
      objective: generated.objective,
      successCriteria: generated.successCriteria,
      feedbackFocus: generated.feedbackFocus,
    });
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

    const result = await generatePlaybook({ ...missionContext, description: null });

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

    expect(await generatePlaybook({ ...missionContext, title: "미션", description: null })).toBeNull();
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

    expect(await generatePlaybook({ ...missionContext, title: "미션", description: null })).toBeNull();
  });

  it("LLM 호출이 실패하면 null (플레이북 없이 진행)", async () => {
    mockedChat.mockResolvedValue({ ok: false, reason: "no_api_key" });
    expect(await generatePlaybook({ ...missionContext, title: "미션", description: null })).toBeNull();
  });

  it("JSON이 깨져 있으면 null", async () => {
    mockedChat.mockResolvedValue({ ok: true, content: "이건 JSON이 아니에요" });
    expect(await generatePlaybook({ ...missionContext, title: "미션", description: null })).toBeNull();
  });

  it.each([
    ["objective", (value: typeof generated) => { value.objective = "미소로 마무리한다."; }],
    ["successCriteria[0]", (value: typeof generated) => { value.successCriteria[0] = "표정을 확인한다."; }],
    ["feedbackFocus[0]", (value: typeof generated) => { value.feedbackFocus[0] = "시선 반응"; }],
    ["flow[0].step", (value: typeof generated) => { value.flow[0].step = "눈맞춤으로 시작한다."; }],
    ["flow[0].advanceExamples[0]", (value: typeof generated) => { value.flow[0].advanceExamples[0] = "몸짓으로 답한다."; }],
    ["responseRules[0].when", (value: typeof generated) => { value.responseRules[0].when = "목소리 톤이 낮음"; }],
    ["responseRules[0].then", (value: typeof generated) => { value.responseRules[0].then = "발화 속도를 조절하도록 유도"; }],
  ])("%s의 비관찰 표현을 검출한다", (field, mutate) => {
    const candidate = JSON.parse(JSON.stringify(generated)) as typeof generated;
    mutate(candidate);

    expect(findPlaybookObservabilityViolation(candidate)).toMatchObject({ field });
  });

  it.each([
    ["objective", (value: typeof generated) => { value.objective = "3턴 이내에 과제를 수행한다."; }],
    ["successCriteria[0]", (value: typeof generated) => { value.successCriteria[0] = "3회 이내에 답한다."; }],
    ["feedbackFocus[0]", (value: typeof generated) => { value.feedbackFocus[0] = "질문 2번 이상 여부"; }],
    ["flow[0].step", (value: typeof generated) => { value.flow[0].step = "2턴 이상 대화를 이어간다."; }],
    ["flow[0].advanceExamples[0]", (value: typeof generated) => { value.flow[0].advanceExamples[0] = "3번 질문했어요."; }],
    ["responseRules[0].when", (value: typeof generated) => { value.responseRules[0].when = "2턴 이상 대화를 지속할 때"; }],
    ["responseRules[0].then", (value: typeof generated) => { value.responseRules[0].then = "3회 이내에 마무리하도록 유도"; }],
  ])("%s의 미션 비근거 정량 조건을 검출한다", (field, mutate) => {
    const candidate = JSON.parse(JSON.stringify(generated)) as typeof generated;
    mutate(candidate);

    expect(findPlaybookQuantitativeConstraintViolation(candidate, missionContext)).toMatchObject({
      field,
    });
  });

  it.each([
    ["미소", "미소로 마무리한다."],
    ["웃는 얼굴", "웃는 얼굴로 반응한다."],
    ["표정", "표정을 확인한다."],
    ["시선", "시선을 교환한다."],
    ["눈맞춤", "눈 맞춤을 유지한다."],
    ["눈을 마주치다", "눈을 마주치며 인사한다."],
    ["몸짓", "몸짓으로 답한다."],
    ["제스처", "제스처를 사용한다."],
    ["자세", "바른 자세를 유지한다."],
    ["목소리", "밝은 목소리로 말한다."],
    ["음성", "음성 톤을 확인한다."],
    ["톤", "톤을 밝게 유지한다."],
    ["음량", "음량을 조절한다."],
    ["말하는 속도", "말하는 속도를 늦춘다."],
    ["발화 속도", "발화 속도를 확인한다."],
  ])("금지 표현군 %s을 검출한다", (term, text) => {
    const candidate = { ...generated, objective: text };
    expect(findPlaybookObservabilityViolation(candidate)).toEqual({ field: "objective", term });
  });

  it("텍스트와 발화 순서로 확인 가능한 정상 플레이북은 통과한다", () => {
    expect(findPlaybookObservabilityViolation(generated)).toBeNull();
    expect(
      findPlaybookObservabilityViolation({ ...generated, objective: "메뉴를 자세히 설명한다." })
    ).toBeNull();
    expect(
      findPlaybookObservabilityViolation({ ...generated, objective: "주문 버튼을 누른다" })
    ).toBeNull();
  });

  it.each(["목소리 톤을 밝게 한다", "밝은 톤으로 말한다"])(
    "독립적인 톤 표현은 계속 차단한다: %s",
    (objective) => {
      expect(findPlaybookObservabilityViolation({ ...generated, objective })).toMatchObject({
        field: "objective",
      });
    }
  );

  it("미션 원문에 명시된 횟수는 회/번 표현 차이를 허용하되 턴 수로 확대하지 않는다", () => {
    const candidate = { ...generated, successCriteria: ["사용자가 질문을 3회 한다."] };
    const numberedMission = { title: "상대에게 3번 질문하기", description: null };

    expect(findPlaybookQuantitativeConstraintViolation(candidate, numberedMission)).toBeNull();
    expect(
      findPlaybookQuantitativeConstraintViolation(
        { ...generated, successCriteria: ["3턴 이내에 질문한다."] },
        numberedMission
      )
    ).toEqual({ field: "successCriteria[0]", term: "3턴" });
  });

  it("첫 응답이 비관찰 표현을 포함하면 한 번 재시도하고 정상 결과만 임베딩한다", async () => {
    mockedChat
      .mockResolvedValueOnce({
        ok: true,
        content: JSON.stringify({ ...generated, objective: "미소로 마무리한다." }),
      })
      .mockResolvedValueOnce({ ok: true, content: JSON.stringify(generated) });
    mockedEmbed.mockResolvedValue({ ok: true, embeddings: [] });

    const result = await generatePlaybook(missionContext);

    expect(result?.objective).toBe(generated.objective);
    expect(mockedChat).toHaveBeenCalledTimes(2);
    expect(mockedEmbed).toHaveBeenCalledTimes(1);
    const retryPrompt = mockedChat.mock.calls[1][0][1].content;
    expect(retryPrompt).toContain("재생성 보정 지시");
    expect(retryPrompt).toContain("텍스트로 관찰할 수 없는 표현 포함 때문에 거부되었습니다");
    expect(retryPrompt).toContain("위반 위치: objective");
    expect(retryPrompt).toContain("위반 표현 유형: 미소");
    expect(retryPrompt).toContain("대화 텍스트와 발화 순서로 직접 확인 가능한 행동만 사용하세요");
    expect(retryPrompt).not.toContain("미소로 마무리한다");
    expect(mockedWarn).toHaveBeenCalledWith(
      { field: "objective", term: "미소" },
      "대화 플레이북 비관찰 표현 검증 실패"
    );
  });

  it("두 응답 모두 비관찰 표현을 포함하면 null이고 임베딩하지 않는다", async () => {
    mockedChat.mockResolvedValue({
      ok: true,
      content: JSON.stringify({ ...generated, objective: "미소로 마무리한다." }),
    });

    expect(await generatePlaybook(missionContext)).toBeNull();
    expect(mockedChat).toHaveBeenCalledTimes(2);
    expect(mockedEmbed).not.toHaveBeenCalled();
  });

  it("미션 비근거 정량 조건도 폐기하고 보정 지시와 함께 재시도한다", async () => {
    mockedChat
      .mockResolvedValueOnce({
        ok: true,
        content: JSON.stringify({
          ...generated,
          successCriteria: ["3턴 이내에 핵심 과제를 수행한다."],
        }),
      })
      .mockResolvedValueOnce({ ok: true, content: JSON.stringify(generated) });
    mockedEmbed.mockResolvedValue({ ok: true, embeddings: [] });

    const result = await generatePlaybook(missionContext);

    expect(result?.successCriteria).toEqual(generated.successCriteria);
    expect(mockedChat).toHaveBeenCalledTimes(2);
    expect(mockedEmbed).toHaveBeenCalledTimes(1);
    const retryPrompt = mockedChat.mock.calls[1][0][1].content;
    expect(retryPrompt).toContain("미션 원문에 근거 없는 정량 조건 포함 때문에 거부되었습니다");
    expect(retryPrompt).toContain("위반 위치: successCriteria[0]");
    expect(retryPrompt).toContain("위반 표현 유형: 3턴");
    expect(retryPrompt).not.toContain("3턴 이내에 핵심 과제를 수행한다");
    expect(mockedWarn).toHaveBeenCalledWith(
      { field: "successCriteria[0]", term: "3턴" },
      "대화 플레이북 미션 비근거 정량 조건 검증 실패"
    );
  });
});

describe("플레이북 미션 공통 컨텍스트", () => {
  it("제목/설명/카테고리/난이도/tags만 프롬프트 입력으로 사용한다", () => {
    const messages = buildPlaybookMessages(missionContext);
    const systemContent = messages[0].content;
    const userContent = messages[1].content;

    expect(userContent).toContain('"title":"영화 감상 공유"');
    expect(userContent).toContain('"category":"감상 공유"');
    expect(userContent).toContain('"difficulty":2');
    expect(userContent).toContain('"tags":["영화","감정 표현"]');
    expect(userContent).not.toContain("Mission_Setups");
    expect(userContent).not.toContain("persona");
    expect(userContent).not.toContain("userTask");
    expect(systemContent).toContain("사용자 행동 중심");
    expect(systemContent).toContain("실제 대화 기록에서 관찰 가능한 구체적인 성공 행동");
    expect(systemContent).toContain("사용자별 설정으로 확대 해석하지 마세요");
  });

  it("모든 플레이북 필드에 동일한 관찰 가능성과 미션 근거성 원칙을 적용한다", () => {
    const systemContent = buildPlaybookMessages(missionContext)[0].content;

    expect(systemContent).toContain(
      "모든 생성 필드에 동일하게 적용되는 최우선 공통 원칙"
    );
    expect(systemContent).toContain(
      "objective, successCriteria, feedbackFocus, flow.step, flow.advanceExamples, responseRules.when, responseRules.then"
    );
    expect(systemContent).toContain("대화 텍스트와 발화 순서뿐입니다");
    expect(systemContent).toContain("미소, 웃는 얼굴, 표정, 시선");
    expect(systemContent).toContain("눈맞춤, 눈을 마주침");
    expect(systemContent).toContain("몸짓, 제스처, 자세");
    expect(systemContent).toContain("실제 목소리·음성의 톤·크기·밝기·속도");
    expect(systemContent).toContain("감정을 겉으로 드러내는 비언어적 행동");
    expect(systemContent).toContain("텍스트로 직접 확인할 수 없는 행동이나 상태");
    expect(systemContent).toContain("어떤 대상 필드에도 작성하지 마세요");
    expect(systemContent).toContain("이모티콘·이모지·웃음 표시·텍스트 표현");
    expect(systemContent).toContain('"텍스트에서 유추할 수 있다"');
    expect(systemContent).toContain('"미소 이모티콘으로 표현한다"');
    expect(systemContent).toContain("먼저 인사한다, 메뉴명을 말한다, 질문한다");
    expect(systemContent).toContain("상대의 이전 발화 내용에 맞게 응답한다");
    expect(systemContent).toContain("감사 표현을 한다, 마무리 인사를 한다");
    expect(systemContent).toContain("원 미션에 없는 성공·실패·종료 조건을 발명하지 마세요");
    expect(systemContent).toContain("tags는 맥락 이해에만 참고하며");
    expect(systemContent).toContain("최소화·금지·억제·턴 수·시간·횟수 조건");
    expect(systemContent).toContain('"3턴", "30초", "질문 2번"');
    expect(systemContent).toContain('"3턴 이내", "2턴 이상", "3회 이내", "2번 이상"');
    expect(systemContent).toContain('"3번 질문하기"처럼 횟수가 직접 명시된 경우에만');
    expect(systemContent).toContain("원문에 있는 숫자를 다른 턴 수·시간·횟수 조건으로 확대하지 마세요");
    expect(systemContent).toContain("숫자·단위뿐 아니라 그 조건이 수식하는 대상과 사용자 행동도 그대로 보존하세요");
    expect(systemContent).toContain('"1문장으로 안부 인사"는 사용자의 안부 인사 발화 자체');
    expect(systemContent).toContain("전체 대화를 1~2문장으로 제한하거나");
    expect(systemContent).toContain("추가 질문·응답을 금지하거나, 곧바로 대화를 종료");
    expect(systemContent).toContain("전체 대화 길이, 전체 턴 수, 다른 행동의 횟수 또는 종료 조건");
    expect(systemContent).toContain('"추가 질문 금지"');
    expect(systemContent).toContain('"설명 최소화"');
    expect(systemContent).toContain('"한 문장으로 주문"은 주문 표현 자체가 한 문장이라는 뜻');
    expect(systemContent).toContain('"메뉴명과 수량만 포함"');
    expect(systemContent).toContain('"수식어 금지"');
    expect(systemContent).toContain('"불필요한 설명 없이"로 확대 해석하지 마세요');
    expect(systemContent).toContain("자연스러운 확인 질문·답변·추가 응답은 허용됩니다");
    expect(systemContent).toContain("추가 발화를 자동으로 불필요·실패·감점 요소로 취급하지 마세요");
    expect(systemContent).toContain("successCriteria는 제목·설명의 핵심 행동 수행 여부");
    expect(systemContent).toContain("feedbackFocus는 successCriteria와 직접 연결된 관찰 항목만");
    expect(systemContent).toContain("직접 요구하지 않은 표현 형식을 successCriteria나 feedbackFocus로 승격하지 마세요");
    expect(systemContent).toContain("물음표·느낌표 같은 문장부호 사용");
    expect(systemContent).toContain("특정 호칭 사용");
    expect(systemContent).toContain("가족·친구 등 관계를 직접 언급");
    expect(systemContent).toContain("문말 기호");
    expect(systemContent).toContain("존댓말·반말·간결체 같은 특정 문체");
    expect(systemContent).toContain("표현 방식의 예시, 자연스러워 보이는 말투, 권장 스타일");
    expect(systemContent).toContain("criterion이나 피드백 중점 항목으로 만들지 마세요");
    expect(systemContent).toContain("flow와 responseRules는 위 원칙을 그대로 지키면서");
    expect(systemContent).toContain("objective, successCriteria, feedbackFocus, flow, responseRules는 서로 모순되면 안 됩니다");
    expect(systemContent).toContain("한 필드에서 요구하거나 허용한 행동을 다른 필드에서 금지·실패·종료 조건");
    expect(systemContent).toContain("flow에서 추가 질문이나 응답을 유도하면서 responseRules에서 이를 금지");
    expect(systemContent).toContain("모든 필드를 함께 검토하여 미션 목표, 진행 단계, 대응 규칙이 같은 방향인지 확인하세요");
    expect(systemContent).toContain("각 항목은 다른 항목과 독립적으로 평가할 수 있는 서로 다른 사용자 행동");
    expect(systemContent).toContain("표현 예시·동의어·말투 변형을 각각 별도의 필수 성공조건으로 나열하지 말고");
    expect(systemContent).toContain("선택 가능한 여러 표현을 모두 수행해야 하는 필수 조건처럼 만들지 마세요");
    expect(systemContent).toContain('미션의 핵심 행동이 "사용자가 먼저 인사하기", "먼저 질문하기", "먼저 말 걸기"라면');
    expect(systemContent).toContain("첫 단계에서 상대역 AI가 인사·질문·말 걸기를 먼저 수행하지 마세요");
    expect(systemContent).toContain("사용자가 먼저 시작할 수 있는 상황만 열어 주고");
    expect(systemContent).toContain("사용자의 과제를 대신 수행하지 않습니다");
  });

  it("플레이북의 모든 생성 문자열을 의미가 완결된 형태로 요구한다", () => {
    const systemContent = buildPlaybookMessages(missionContext)[0].content;

    expect(systemContent).toContain(
      "objective, successCriteria, feedbackFocus, flow.step, flow.advanceExamples, responseRules.when, responseRules.then"
    );
    expect(systemContent).toContain("모든 문자열을 문장 중간에서 끊지 마세요");
    expect(systemContent).toContain("의미가 완결된 문장 또는 자립 가능한 표현");
    expect(systemContent).toContain('"후", "하고", "하며", "또는", "및"');
    expect(systemContent).toContain('responseRules.then은 "계산 안내 후 "처럼');
    expect(systemContent).toContain("상대역이 취할 대응 방향을 끝까지 작성하세요");
    expect(systemContent).toContain("내용을 줄여 완결하고, 문장을 잘라 길이만 맞추지 마세요");
  });

  it("setupGuideline이 없거나 잘못되면 tags를 빈 배열로 처리한다", () => {
    const base = {
      title: "미션",
      description: null,
      category: "대화",
      difficulty: 1,
    };

    expect(toPlaybookMissionContext({ ...base, setup_guideline: null }).tags).toEqual([]);
    expect(
      toPlaybookMissionContext({ ...base, setup_guideline: { tags: ["불완전"] } }).tags
    ).toEqual([]);
  });

  it("유효한 setupGuideline에서는 미션 공통 tags만 추출한다", () => {
    const guideline = {
      defaults: {
        environment: "daily_place",
        partnerRole: "other",
        intimacyLevel: 2,
        formalityLevel: 3,
        partnerGender: "female",
        partnerAgeGroup: "twenties",
      },
      disabled: {
        environment: [], partnerRole: [], intimacyLevel: [], formalityLevel: [],
        partnerGender: [], partnerAgeGroup: [],
      },
      note: null,
      recommendedTopics: [],
      tags: ["첫 만남", "가벼운 질문"],
    };

    expect(
      toPlaybookMissionContext({
        title: "미션", description: null, category: "대화", difficulty: 1,
        setup_guideline: guideline,
      }).tags
    ).toEqual(guideline.tags);
  });
});

describe("parseStoredPlaybook", () => {
  it("정상 형식을 통과시킨다", () => {
    expect(parseStoredPlaybook(stored([[1, 0]], [[[0, 1]]]))?.flow).toHaveLength(3);
  });

  it("새 optional 필드가 있는 저장 플레이북을 보존한다", () => {
    const parsed = parseStoredPlaybook({ ...stored([], []), ...generated });
    expect(parsed?.objective).toBe(generated.objective);
    expect(parsed?.successCriteria).toEqual(generated.successCriteria);
    expect(parsed?.feedbackFocus).toEqual(generated.feedbackFocus);
  });

  it("새 필드가 없는 기존 저장 플레이북도 정상 파싱한다", () => {
    const parsed = parseStoredPlaybook(stored([], []));
    expect(parsed).not.toBeNull();
    expect(parsed?.objective).toBeUndefined();
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
