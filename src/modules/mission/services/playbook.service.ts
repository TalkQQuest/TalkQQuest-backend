// modules/mission/services/playbook.service.ts
//
// 미션별 대화 진행 지침(플레이북) 생성·매칭.
//
// 기존 프롬프트는 "하면 안 되는 것"(배역 이탈·과제 선수행 금지)만 담고 있어서, 대화가 어떻게
// 흘러가야 하는지에 대한 축이 비어 있었다. AI가 매 턴 직전 발화에만 반응하다 보니 사용자가
// 과제를 이미 수행했는데도 겉돌거나, 사용자가 막혔을 때 풀어주지 못하는 문제가 생긴다.
//
// 플레이북은 두 부분이다.
//  - flow: 대화가 거쳐야 할 단계 3개. 짧고 항상 주입한다.
//  - responseRules: "이런 상황이면 이런 방향으로" 규칙. 전부 넣으면 매 턴 토큰이 커지므로,
//    사용자 발화와 의미가 가까운 것만 골라 넣는다.
//
// 규칙 선별에 정규식 대신 임베딩을 쓰는 이유: "뭘 말해야 할지 모르겠어" / "딱히 생각이 안 나"
// 처럼 표현이 조금만 달라져도 정규식은 놓치는데, 이런 상황 매칭은 표현 변형이 무한하다.
// (정체 질문처럼 표현이 한정적인 곳은 여전히 정규식이 더 싸고 정확하다 — conversation-guard 참고)

import { z } from "zod";
import { logger } from "../../../config/logger";
import {
  callUpstageChat,
  callUpstageEmbedding,
  cosine,
  parseJsonResponse,
  rankByVector,
} from "../../../shared/ai";

const PLAYBOOK_MAX_TOKENS = 700;
const PLAYBOOK_TEMPERATURE = 0.6;

const FLOW_STEPS = 3;
const RULE_COUNT = 5;

// 매 턴 프롬프트에 넣을 규칙 수. 너무 많이 넣으면 토큰이 커지고 AI가 대본을 읽는 것처럼 굳는다.
export const MAX_INJECTED_RULES = 2;
// 이 값보다 유사도가 낮으면 "관련 없는 상황"으로 보고 넣지 않는다.
//
// 처음 0.5로 잡았으나 실측에서 **한 건도 걸리지 않았다** — 규칙 조건은 발화에 대한 서술이라
// 실제 발화와의 유사도가 잘 맞는 경우에도 0.25를 넘지 못한다. 값 자체가 잘못된 축이었다.
// 0.2로 낮춰 발동은 시키되, 규칙은 프롬프트에 힌트를 한 줄 더하는 정도라 오탐 손해가 작다.
// (단계 진행과 달리 여기는 상대 비교를 쓸 수 없다 — "해당 규칙 없음"도 정상 상태이기 때문.)
export const RULE_MATCH_THRESHOLD = 0.2;

// 단계 진행은 **절대 유사도가 아니라 단계 간 상대 비교**로 판정한다.
//
// 실측(라벨링 12건)에서 발화-예시 유사도는 단계와 무관하게 0.21~0.36에 뭉쳐, 절대 임계값으로는
// 어떤 값을 잡아도 전부 걸리거나 전부 안 걸린다. 반면 **순위**는 살아 있어서
// argmax 정확도가 9/12(무작위 4/12)였다. 그래서 "다음 단계가 현재 단계보다 더 가까운가"만 본다.
//
// margin은 그 차이가 이 정도는 나야 넘긴다는 여유값. 0.02일 때 정확 9/12에 조기 진행이 1건으로
// 가장 적었다(0이면 조기 2건). 조기 진행은 사용자가 아직 연습 중인 단계를 건너뛰게 만들어
// 지연보다 손해가 크고, 지연은 아래 턴 상한이 받아준다.
export const FLOW_ADVANCE_MARGIN = 0.02;

// 통과 조건에 걸리지 않아도 단계당 이 턴 수를 넘기면 다음 단계로 올린다.
// 임베딩이 실패하거나 사용자가 예상 밖으로 흘러갈 때 한 단계에 영영 갇히는 것을 막는 안전장치다.
//
// 판정은 "현재 단계에서 몇 턴을 보냈나"가 아니라 **누적 턴이 (단계+1)×상한을 넘겼나**로 한다.
// 단계가 바뀐 시점을 따로 저장하지 않아 "현재 단계에서의 턴 수"를 알 수 없는데, 누적 턴을
// 그대로 쓰면 상한을 한 번 넘긴 뒤로는 매 턴 상한이 걸려 단계가 연달아 밀린다.
export const MAX_TURNS_PER_STEP = 4;

const MAX_LINE_LENGTH = 120;

// LLM이 만들어낼 플레이북 형식. 임베딩은 생성 후 서버가 붙인다.
const generatedPlaybookSchema = z.object({
  flow: z
    .array(
      z.object({
        step: z.string().min(1).max(MAX_LINE_LENGTH),
        // 서술("사용자가 근황을 말함")이 아니라 **실제 발화 예시**를 받는다.
        // 서술과 실제 발화는 결이 달라 임베딩 유사도가 0.1~0.3대에 머물고 정답/오답이 겹쳤다.
        // 발화끼리 비교해야 분리가 된다.
        advanceExamples: z.array(z.string().min(1).max(MAX_LINE_LENGTH)).min(2).max(4),
      })
    )
    .length(FLOW_STEPS),
  responseRules: z
    .array(
      z.object({
        when: z.string().min(1).max(MAX_LINE_LENGTH),
        then: z.string().min(1).max(MAX_LINE_LENGTH),
      })
    )
    .min(1)
    .max(RULE_COUNT),
});

// DB(Missions.dialogue_playbook)에 저장되는 형태. 규칙마다 when의 임베딩을 함께 들고 있다.
// 임베딩 생성이 실패했을 수 있으므로 whenEmbedding은 optional이다(그 경우 매칭에서 빠진다).
const storedPlaybookSchema = z.object({
  flow: z.array(
    z.object({
      step: z.string(),
      // 이 단계를 통과했다고 볼 사용자 발화 예시들. 각각 임베딩해 두고 매 턴 대조한다.
      advanceExamples: z.array(z.string()),
      advanceEmbeddings: z.array(z.array(z.number())).optional(),
    })
  ),
  responseRules: z.array(
    z.object({
      when: z.string(),
      then: z.string(),
      whenEmbedding: z.array(z.number()).optional(),
    })
  ),
});

export type DialoguePlaybook = z.infer<typeof storedPlaybookSchema>;

const buildPlaybookMessages = (missionTitle: string, missionDescription: string | null) => {
  const context = missionDescription
    ? `미션: ${missionTitle}\n미션 설명: ${missionDescription}`
    : `미션: ${missionTitle}`;

  return [
    {
      role: "system" as const,
      content: [
        "당신은 대화 연습 앱의 시나리오 설계자입니다.",
        "사용자가 주어진 미션을 연습할 때, 상대역 AI가 따라야 할 대화 지침을 만듭니다.",
        "",
        "중요: 미션 설명은 **사용자에게** 주어진 과제입니다. 상대역이 할 일이 아닙니다.",
        "상대역의 목표는 사용자가 그 과제를 해낼 수 있는 상황을 만들어 주는 것입니다.",
        "",
        `1) flow — 대화가 거쳐야 할 단계 ${FLOW_STEPS}개. 각 단계는 두 항목으로 씁니다.`,
        '   step: 그 단계에서 상대역이 무엇을 하는지. 예: "가볍게 근황을 물어 편한 분위기 만들기"',
        '   advanceExamples: 이 단계를 지났다고 볼 만한 **사용자의 실제 발화**를 2~3개.',
        '     설명문이 아니라 사용자가 입 밖으로 낼 말 그대로 씁니다.',
        '     ✗ "사용자가 근황을 꺼냄"   ✓ "요즘 시험 준비하느라 바빠"',
        "     상대역의 말이 아니라 **사용자가 할 말**이어야 합니다. 표현이 다양하도록 서로 다르게 씁니다.",
        "",
        `2) responseRules — 자주 나올 상황과 대응 방향 ${RULE_COUNT}개.`,
        '   when: 사용자가 보일 만한 반응을 구체적으로. 예: "무슨 말을 해야 할지 모르겠다고 함"',
        '   then: 상대역이 어느 방향으로 반응할지. 예: "선택지를 좁혀 하나만 물어보기"',
        "   then에는 **할 말을 그대로 쓰지 말고 방향만** 씁니다. 대본이 되면 대화가 딱딱해집니다.",
        "   사용자가 과제를 이미 수행한 상황에 대한 규칙도 반드시 하나 넣으세요.",
        "",
        `- 모든 문장은 ${MAX_LINE_LENGTH}자 이내 한 줄입니다.`,
        "- 반드시 아래 JSON 형식으로만 응답하세요.",
        '{ "flow": [{ "step": "string", "advanceExamples": ["string"] }], "responseRules": [{ "when": "string", "then": "string" }] }',
      ].join("\n"),
    },
    {
      role: "user" as const,
      content: `${context}\n\n이 미션의 대화 지침을 만들어주세요.`,
    },
  ];
};

// 미션별 플레이북 생성. 실패하면 null → 호출부가 플레이북 없이 진행한다(기존 동작 유지).
export const generatePlaybook = async (
  missionTitle: string,
  missionDescription: string | null
): Promise<DialoguePlaybook | null> => {
  const result = await callUpstageChat(buildPlaybookMessages(missionTitle, missionDescription), {
    temperature: PLAYBOOK_TEMPERATURE,
    maxTokens: PLAYBOOK_MAX_TOKENS,
    jsonMode: true,
  });
  if (!result.ok) {
    logger.warn({ reason: result.reason }, "대화 플레이북 생성 LLM 호출 실패");
    return null;
  }

  const parsed = parseJsonResponse(result.content, generatedPlaybookSchema, "대화 플레이북");
  if (!parsed) return null;

  // 규칙의 when과 단계의 advanceWhen을 미리 임베딩해 함께 저장한다.
  // 매 턴 다시 임베딩하면 비용·지연이 생기고, 두 종류를 한 번의 호출로 묶어 왕복도 줄인다.
  // 임베딩이 실패해도 플레이북 자체는 쓸모가 있으므로(단계는 턴 수로도 넘어간다) 그대로 저장한다.
  const ruleConditions = parsed.responseRules.map((rule) => rule.when);
  // 단계마다 예시가 여러 개라 평탄화해 한 번에 임베딩하고, 아래에서 다시 단계별로 나눈다.
  const stepExamples = parsed.flow.flatMap((step) => step.advanceExamples);
  const embedded = await callUpstageEmbedding([...ruleConditions, ...stepExamples], "passage");
  if (!embedded.ok) {
    logger.warn({ reason: embedded.reason }, "플레이북 임베딩 실패 — 단계는 턴 수로만 진행");
  }

  let cursor = ruleConditions.length;
  return {
    flow: parsed.flow.map((step) => {
      const slice = embedded.ok
        ? embedded.embeddings.slice(cursor, cursor + step.advanceExamples.length)
        : [];
      cursor += step.advanceExamples.length;
      return { ...step, ...(embedded.ok ? { advanceEmbeddings: slice } : {}) };
    }),
    responseRules: parsed.responseRules.map((rule, i) => ({
      ...rule,
      ...(embedded.ok ? { whenEmbedding: embedded.embeddings[i] } : {}),
    })),
  };
};

// DB의 Json 컬럼은 타입이 보장되지 않으므로 방어적으로 파싱한다. 형식이 깨졌으면 null.
export const parseStoredPlaybook = (raw: unknown): DialoguePlaybook | null => {
  if (!raw) return null;
  const parsed = storedPlaybookSchema.safeParse(raw);
  if (!parsed.success) {
    logger.warn({ issues: parsed.error.issues }, "저장된 플레이북 형식이 올바르지 않음");
    return null;
  }
  return parsed.data;
};

export interface MatchedRule {
  when: string;
  then: string;
  score: number;
}

// 사용자 발화와 의미가 가까운 규칙을 골라낸다.
// 임베딩 호출이 실패하거나 걸리는 규칙이 없으면 빈 배열 → 흐름 지침만 주입된다.
// 이번 턴 사용자 발화 벡터로 관련 규칙을 고른다.
// 벡터를 인자로 받는 이유: 같은 턴에 흐름 단계 판정도 하므로 임베딩을 한 번만 만들어 재사용한다.
export const matchResponseRules = (
  playbook: DialoguePlaybook,
  queryVector: number[]
): MatchedRule[] => {
  const candidates = playbook.responseRules.filter(
    (rule): rule is typeof rule & { whenEmbedding: number[] } =>
      Array.isArray(rule.whenEmbedding) && rule.whenEmbedding.length > 0
  );
  if (candidates.length === 0) return [];

  const matched = rankByVector(
    candidates.map((rule) => ({ when: rule.when, then: rule.then, embedding: rule.whenEmbedding })),
    queryVector,
    { threshold: RULE_MATCH_THRESHOLD, limit: MAX_INJECTED_RULES }
  );

  return matched.map(({ when, then, score }) => ({ when, then, score }));
};

// ── 흐름 단계 진행 ──

export interface FlowProgress {
  /** 이번 턴에 적용할 단계 인덱스. */
  stepIndex: number;
  /** 이번 턴에 보여줄 단계 설명. 플레이북이 없으면 null. */
  step: string | null;
  /** DB에 저장할 값이 바뀌었는지(불필요한 UPDATE를 피하기 위함). */
  advanced: boolean;
}

/**
 * 사용자 발화가 현재 단계의 통과 조건과 맞으면 다음 단계로 올린다.
 *
 * 턴 수로 넘기지 않는 이유: 사용자가 아직 그 단계를 해내지 못했는데 넘어가면 연습할 기회가
 * 사라지고, 반대로 빨리 해낸 사용자는 같은 단계에 묶인다.
 * 다만 임베딩이 없거나(생성 실패) 사용자가 예상 밖으로 흘러가면 한 단계에 갇힐 수 있어,
 * turnsOnStep이 상한을 넘으면 조건과 무관하게 올린다.
 */
export const advanceFlow = (
  playbook: DialoguePlaybook | null,
  currentStep: number,
  /** 이 대화에서 지금까지 오간 사용자 발화 수(누적). */
  totalUserTurns: number,
  queryVector: number[] | null
): FlowProgress => {
  if (!playbook || playbook.flow.length === 0) {
    return { stepIndex: 0, step: null, advanced: false };
  }

  const lastIndex = playbook.flow.length - 1;
  const index = Math.min(Math.max(currentStep, 0), lastIndex);

  // 마지막 단계에서는 더 올릴 곳이 없다.
  if (index >= lastIndex) {
    return { stepIndex: lastIndex, step: playbook.flow[lastIndex].step, advanced: false };
  }

  // 각 단계 점수 = 그 단계의 예시 발화 중 최대 유사도(표현이 다양하므로 최대값 기준).
  const stepScore = (i: number): number => {
    const examples = playbook.flow[i].advanceEmbeddings ?? [];
    if (!queryVector || examples.length === 0) return 0;
    return examples.reduce((max, ex) => Math.max(max, cosine(queryVector, ex)), 0);
  };

  const current = stepScore(index);
  const next = stepScore(index + 1);
  // 두 점수가 모두 0이면 임베딩이 없다는 뜻이라 상대 비교가 무의미하다 → 턴 상한에만 맡긴다.
  const matched = (current > 0 || next > 0) && next > current + FLOW_ADVANCE_MARGIN;

  // 누적 턴 기준 상한: 0단계는 4턴, 1단계는 8턴을 넘기면 강제로 다음으로.
  const turnCapReached = totalUserTurns >= (index + 1) * MAX_TURNS_PER_STEP;
  const shouldAdvance = matched || turnCapReached;
  const nextIndex = shouldAdvance ? index + 1 : index;

  return {
    stepIndex: nextIndex,
    step: playbook.flow[nextIndex].step,
    advanced: nextIndex !== currentStep,
  };
};
