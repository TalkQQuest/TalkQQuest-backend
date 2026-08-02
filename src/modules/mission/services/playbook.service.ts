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
  matchByEmbedding,
  parseJsonResponse,
} from "../../../shared/ai";

const PLAYBOOK_MAX_TOKENS = 700;
const PLAYBOOK_TEMPERATURE = 0.6;

const FLOW_STEPS = 3;
const RULE_COUNT = 5;

// 매 턴 프롬프트에 넣을 규칙 수. 너무 많이 넣으면 토큰이 커지고 AI가 대본을 읽는 것처럼 굳는다.
export const MAX_INJECTED_RULES = 2;
// 이 값보다 유사도가 낮으면 "관련 없는 상황"으로 보고 넣지 않는다.
// 낮추면 엉뚱한 규칙이 들어와 대화가 부자연스러워지고, 높이면 규칙이 거의 안 걸린다.
export const RULE_MATCH_THRESHOLD = 0.5;

const MAX_LINE_LENGTH = 120;

// LLM이 만들어낼 플레이북 형식. 임베딩은 생성 후 서버가 붙인다.
const generatedPlaybookSchema = z.object({
  flow: z.array(z.string().min(1).max(MAX_LINE_LENGTH)).length(FLOW_STEPS),
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
  flow: z.array(z.string()),
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
        `1) flow — 대화가 거쳐야 할 단계 ${FLOW_STEPS}개.`,
        '   예: "도입: 가볍게 근황을 물어 편한 분위기 만들기"',
        "   각 단계는 상대역이 무엇을 하는지 한 줄로 씁니다.",
        "",
        `2) responseRules — 자주 나올 상황과 대응 방향 ${RULE_COUNT}개.`,
        '   when: 사용자가 보일 만한 반응을 구체적으로. 예: "무슨 말을 해야 할지 모르겠다고 함"',
        '   then: 상대역이 어느 방향으로 반응할지. 예: "선택지를 좁혀 하나만 물어보기"',
        "   then에는 **할 말을 그대로 쓰지 말고 방향만** 씁니다. 대본이 되면 대화가 딱딱해집니다.",
        "   사용자가 과제를 이미 수행한 상황에 대한 규칙도 반드시 하나 넣으세요.",
        "",
        `- 모든 문장은 ${MAX_LINE_LENGTH}자 이내 한 줄입니다.`,
        "- 반드시 아래 JSON 형식으로만 응답하세요.",
        '{ "flow": ["string"], "responseRules": [{ "when": "string", "then": "string" }] }',
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

  // 규칙의 when을 미리 임베딩해 함께 저장한다. 매 턴 다시 임베딩하면 비용·지연이 생긴다.
  // 임베딩이 실패해도 플레이북 자체는 쓸모가 있으므로(flow는 항상 주입) 그대로 저장한다.
  const conditions = parsed.responseRules.map((rule) => rule.when);
  const embedded = await callUpstageEmbedding(conditions, "passage");
  if (!embedded.ok) {
    logger.warn({ reason: embedded.reason }, "플레이북 규칙 임베딩 실패 — 흐름만 사용");
  }

  return {
    flow: parsed.flow,
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
export const matchResponseRules = async (
  playbook: DialoguePlaybook,
  userMessage: string
): Promise<MatchedRule[]> => {
  const candidates = playbook.responseRules.filter(
    (rule): rule is typeof rule & { whenEmbedding: number[] } =>
      Array.isArray(rule.whenEmbedding) && rule.whenEmbedding.length > 0
  );
  if (candidates.length === 0) return [];

  // 저장된 규칙은 passage로 임베딩해 뒀고, 찾는 쪽인 사용자 발화는 query로 임베딩해야
  // 유사도가 제대로 나온다(matchByEmbedding이 query 임베딩을 담당한다).
  const matched = await matchByEmbedding(
    candidates.map((rule) => ({ when: rule.when, then: rule.then, embedding: rule.whenEmbedding })),
    userMessage,
    { threshold: RULE_MATCH_THRESHOLD, limit: MAX_INJECTED_RULES, label: "대화 플레이북 규칙" }
  );

  return matched.map(({ when, then, score }) => ({ when, then, score }));
};
