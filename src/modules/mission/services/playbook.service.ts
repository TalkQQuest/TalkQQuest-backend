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
import { setupGuidelineSchema } from "../dtos/mission.dto";
import {
  callUpstageChat,
  callUpstageEmbedding,
  cosine,
  generateWithRetry,
  parseJsonResponse,
  rankByVector,
} from "../../../shared/ai";

const PLAYBOOK_MAX_TOKENS = 1000;
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
const MAX_OBJECTIVE_LENGTH = 300;
const MAX_METADATA_ITEMS = 5;

const playbookMetadataSchema = z.object({
  objective: z.string().min(1).max(MAX_OBJECTIVE_LENGTH).optional(),
  successCriteria: z
    .array(z.string().min(1).max(MAX_LINE_LENGTH))
    .max(MAX_METADATA_ITEMS)
    .optional(),
  feedbackFocus: z
    .array(z.string().min(1).max(MAX_LINE_LENGTH))
    .max(MAX_METADATA_ITEMS)
    .optional(),
});

// LLM이 만들어낼 플레이북 형식. 임베딩은 생성 후 서버가 붙인다.
const generatedPlaybookSchema = z.object({
  ...playbookMetadataSchema.shape,
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

type GeneratedPlaybook = z.infer<typeof generatedPlaybookSchema>;

export interface PlaybookObservabilityViolation {
  field: string;
  term: string;
}

interface PlaybookRetryCorrection extends PlaybookObservabilityViolation {
  reason: string;
}

const NON_OBSERVABLE_PATTERNS: { term: string; pattern: RegExp }[] = [
  { term: "미소", pattern: /미소/u },
  { term: "웃는 얼굴", pattern: /웃는\s*얼굴/u },
  { term: "표정", pattern: /표정/u },
  { term: "시선", pattern: /시선/u },
  { term: "눈맞춤", pattern: /눈\s*맞춤/u },
  { term: "눈을 마주치다", pattern: /눈을\s*마주(?:치|보)/u },
  { term: "몸짓", pattern: /몸짓/u },
  { term: "제스처", pattern: /제스처/u },
  // "자세히 설명한다"는 텍스트 행동이므로 신체 posture 의미의 "자세"만 막는다.
  { term: "자세", pattern: /자세(?!히|하)/u },
  { term: "목소리", pattern: /목소리/u },
  { term: "음성", pattern: /음성/u },
  { term: "톤", pattern: /(?<![가-힣])톤/u },
  { term: "음량", pattern: /음량/u },
  { term: "말하는 속도", pattern: /말하는\s*속도/u },
  { term: "발화 속도", pattern: /발화\s*속도/u },
];

const generatedPlaybookTextFields = (
  playbook: GeneratedPlaybook
): { field: string; value: string }[] => [
  ...(playbook.objective !== undefined
    ? [{ field: "objective", value: playbook.objective }]
    : []),
  ...(playbook.successCriteria ?? []).map((value, index) => ({
    field: `successCriteria[${index}]`,
    value,
  })),
  ...(playbook.feedbackFocus ?? []).map((value, index) => ({
    field: `feedbackFocus[${index}]`,
    value,
  })),
  ...playbook.flow.flatMap((step, flowIndex) => [
    { field: `flow[${flowIndex}].step`, value: step.step },
    ...step.advanceExamples.map((value, exampleIndex) => ({
      field: `flow[${flowIndex}].advanceExamples[${exampleIndex}]`,
      value,
    })),
  ]),
  ...playbook.responseRules.flatMap((rule, ruleIndex) => [
    { field: `responseRules[${ruleIndex}].when`, value: rule.when },
    { field: `responseRules[${ruleIndex}].then`, value: rule.then },
  ]),
];

/** LLM 생성 결과에 텍스트 대화만으로 확인할 수 없는 표현이 있는지 찾는다. */
export const findPlaybookObservabilityViolation = (
  playbook: GeneratedPlaybook
): PlaybookObservabilityViolation | null => {
  for (const { field, value } of generatedPlaybookTextFields(playbook)) {
    const forbidden = NON_OBSERVABLE_PATTERNS.find(({ pattern }) => pattern.test(value));
    if (forbidden) return { field, term: forbidden.term };
  }
  return null;
};

const QUANTITATIVE_CONSTRAINT_PATTERN = /(\d+)\s*(턴|회(?!용)|번(?!째))/gu;

const quantitativeConstraintKey = (count: string, unit: string): string =>
  `${count}:${unit === "턴" ? "turn" : "count"}`;

const extractQuantitativeConstraints = (text: string): Set<string> => {
  const constraints = new Set<string>();
  for (const match of text.matchAll(QUANTITATIVE_CONSTRAINT_PATTERN)) {
    constraints.add(quantitativeConstraintKey(match[1], match[2]));
  }
  return constraints;
};

/** 미션 제목·설명에 근거하지 않은 턴 수·횟수 조건이 있는지 찾는다. */
export const findPlaybookQuantitativeConstraintViolation = (
  playbook: GeneratedPlaybook,
  mission: Pick<PlaybookMissionContext, "title" | "description">
): PlaybookObservabilityViolation | null => {
  const missionConstraints = extractQuantitativeConstraints(
    [mission.title, mission.description ?? ""].join("\n")
  );

  for (const { field, value } of generatedPlaybookTextFields(playbook)) {
    for (const match of value.matchAll(QUANTITATIVE_CONSTRAINT_PATTERN)) {
      if (!missionConstraints.has(quantitativeConstraintKey(match[1], match[2]))) {
        return { field, term: match[0].replace(/\s+/gu, "") };
      }
    }
  }
  return null;
};

// DB(Missions.dialogue_playbook)에 저장되는 형태. 규칙마다 when의 임베딩을 함께 들고 있다.
// 임베딩 생성이 실패했을 수 있으므로 whenEmbedding은 optional이다(그 경우 매칭에서 빠진다).
const storedPlaybookSchema = z.object({
  ...playbookMetadataSchema.shape,
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

export interface PlaybookMissionContext {
  title: string;
  description: string | null;
  category: string;
  difficulty: number;
  tags: string[];
}

// Missions의 공통 데이터만 플레이북 입력으로 만든다. setup_guideline 전체가 유효하지 않으면
// tags도 신뢰하지 않고 빈 배열로 둔다. Mission_Setups나 대화별 persona는 이 경로에 들어오지 않는다.
export const toPlaybookMissionContext = (mission: {
  title: string;
  description: string | null;
  category: string;
  difficulty: number;
  setup_guideline: unknown;
}): PlaybookMissionContext => {
  const guideline = setupGuidelineSchema.safeParse(mission.setup_guideline);
  return {
    title: mission.title,
    description: mission.description,
    category: mission.category,
    difficulty: mission.difficulty,
    tags: guideline.success ? guideline.data.tags : [],
  };
};

export const buildPlaybookMessages = (
  mission: PlaybookMissionContext,
  previousViolation?: PlaybookRetryCorrection
) => {
  const context = JSON.stringify({
    title: mission.title,
    ...(mission.description ? { description: mission.description } : {}),
    category: mission.category,
    difficulty: mission.difficulty,
    ...(mission.tags.length > 0 ? { tags: mission.tags } : {}),
  });

  return [
    {
      role: "system" as const,
      content: [
        "당신은 대화 연습 앱의 시나리오 설계자입니다.",
        "사용자가 주어진 미션을 연습할 때, 상대역 AI가 따라야 할 대화 지침을 만듭니다.",
        "",
        "중요: 미션 설명은 **사용자에게** 주어진 과제입니다. 상대역이 할 일이 아닙니다.",
        "상대역의 목표는 사용자가 그 과제를 해낼 수 있는 상황을 만들어 주는 것입니다.",
        "입력은 여러 사용자가 공유하는 미션 공통 정보뿐입니다.",
        "Mission_Setups, partnerRole, intimacyLevel, formalityLevel, partnerGender, partnerAgeGroup, persona, userTask 또는 사용자별 개인정보를 추측하거나 플레이북에 고정하지 마세요.",
        "tags는 미션의 공통 성격을 이해하는 참고 정보일 뿐입니다. 특정 관계나 말투가 포함돼도 사용자별 설정으로 확대 해석하지 마세요.",
        "",
        "[모든 생성 필드에 동일하게 적용되는 최우선 공통 원칙]",
        "적용 대상: objective, successCriteria, feedbackFocus, flow.step, flow.advanceExamples, responseRules.when, responseRules.then.",
        "- 이 서비스의 플레이북과 향후 피드백이 실제로 확인할 수 있는 정보는 사용자와 AI 사이의 대화 텍스트와 발화 순서뿐입니다.",
        "- 텍스트로 직접 확인할 수 없는 행동이나 상태를 어떤 대상 필드에도 작성하지 마세요.",
        "- 금지 예: 미소, 웃는 얼굴, 표정, 시선, 눈맞춤, 눈을 마주침, 몸짓, 제스처, 자세, 실제 목소리·음성의 톤·크기·밝기·속도, 감정을 겉으로 드러내는 비언어적 행동.",
        '- "텍스트에서 유추할 수 있다"고 단서를 붙이거나, "미소 이모티콘으로 표현한다"처럼 이모티콘·이모지·웃음 표시·텍스트 표현으로 바꾸는 우회도 금지합니다.',
        "- 입력 미션 설명이나 tags에 비텍스트 표현이 있어도 대상 필드에 복사·변형하지 마세요.",
        "- 대신 미션에서 요구하는 경우에만 먼저 인사한다, 메뉴명을 말한다, 질문한다, 상대의 이전 발화 내용에 맞게 응답한다, 감사 표현을 한다, 마무리 인사를 한다처럼 대화 텍스트로 명확히 확인 가능한 행동을 사용하세요.",
        "- 플레이북은 미션 제목·설명의 핵심 행동을 구체화할 뿐, 원 미션에 없는 성공·실패·종료 조건을 발명하지 마세요.",
        "- tags는 맥락 이해에만 참고하며, 제목·설명에 없는 조건을 추가하는 근거로 사용하지 마세요.",
        '- 제목·설명에 직접 명시되지 않은 최소화·금지·억제·턴 수·시간·횟수 조건을 만들지 마세요. 예: "3턴", "30초", "질문 2번", "추가 질문 금지", "설명 최소화".',
        '- 특히 미션 제목·설명에 숫자가 명시되지 않았다면 "3턴 이내", "2턴 이상", "3회 이내", "2번 이상" 같은 정량 조건을 어떤 대상 필드에도 생성하지 마세요.',
        '- 미션 원문에 "3번 질문하기"처럼 횟수가 직접 명시된 경우에만 같은 수치의 횟수 조건을 사용할 수 있습니다. 원문에 있는 숫자를 다른 턴 수·시간·횟수 조건으로 확대하지 마세요.',
        "- 원문의 정량 조건을 사용할 때는 숫자·단위뿐 아니라 그 조건이 수식하는 대상과 사용자 행동도 그대로 보존하세요.",
        '- 예를 들어 "1문장으로 안부 인사"는 사용자의 안부 인사 발화 자체를 한 문장으로 구성하라는 뜻입니다. 전체 대화를 1~2문장으로 제한하거나, 추가 질문·응답을 금지하거나, 곧바로 대화를 종료하라는 뜻이 아닙니다.',
        "- 한 행동에 붙은 문장 수·횟수 조건을 전체 대화 길이, 전체 턴 수, 다른 행동의 횟수 또는 종료 조건으로 옮겨 적용하지 마세요.",
        '- "짧게", "간단히"를 임의의 숫자 제약으로 변환하지 마세요.',
        '- "한 문장으로 주문"은 주문 표현 자체가 한 문장이라는 뜻입니다. 이를 "메뉴명과 수량만 포함", "수식어 금지", "불필요한 설명 없이"로 확대 해석하지 마세요.',
        "- 주문 뒤의 자연스러운 확인 질문·답변·추가 응답은 허용됩니다. 사용자의 추가 발화를 자동으로 불필요·실패·감점 요소로 취급하지 마세요.",
        "- successCriteria는 제목·설명의 핵심 행동 수행 여부를 확인하는 최소 기준만 생성하고, 권장 스타일이나 효율성을 필수 조건으로 승격하지 마세요.",
        "- feedbackFocus는 successCriteria와 직접 연결된 관찰 항목만 생성하고 새로운 제약을 추가하지 마세요.",
        "- 미션 제목·설명에서 직접 요구하지 않은 표현 형식을 successCriteria나 feedbackFocus로 승격하지 마세요.",
        '- 금지 예: 물음표·느낌표 같은 문장부호 사용, 특정 호칭 사용, 가족·친구 등 관계를 직접 언급, 문말 기호, 존댓말·반말·간결체 같은 특정 문체. 미션이 이를 직접 요구하지 않으면 성공 여부와 무관합니다.',
        "- 표현 방식의 예시, 자연스러워 보이는 말투, 권장 스타일은 미션 성공에 반드시 필요한 사용자 행동이 아니므로 criterion이나 피드백 중점 항목으로 만들지 마세요.",
        "- flow와 responseRules는 위 원칙을 그대로 지키면서 사용자가 원 미션을 자연스럽게 수행하도록 돕는 단계와 대응만 생성하세요.",
        "- objective, successCriteria, feedbackFocus, flow, responseRules는 서로 모순되면 안 됩니다. 한 필드에서 요구하거나 허용한 행동을 다른 필드에서 금지·실패·종료 조건으로 만들지 마세요.",
        '- 특히 flow에서 추가 질문이나 응답을 유도하면서 responseRules에서 이를 금지하거나 "불필요한 발화"로 취급하지 마세요. 반대 방향의 모순도 금지합니다.',
        "- 최종 JSON을 내기 전에 모든 필드를 함께 검토하여 미션 목표, 진행 단계, 대응 규칙이 같은 방향인지 확인하세요.",
        "- 아래 배열 개수는 JSON 구조를 위한 형식일 뿐, 사용자 행동의 턴 수·시간·횟수 조건이 아닙니다.",
        "",
        "1) objective — 사용자가 이 미션에서 직접 수행해야 할 전체 목표를 한 문장으로 씁니다.",
        "   상대역 AI의 행동이 아니라 사용자 행동 중심으로, 실제 대화에서 달성 여부를 판단할 수 있게 씁니다.",
        "",
        `2) successCriteria — 실제 대화 기록에서 관찰 가능한 구체적인 성공 행동을 최대 ${MAX_METADATA_ITEMS}개 씁니다.`,
        '   "대화를 잘한다" 같은 추상적 평가 대신 "사용자가 먼저 안부를 묻는다"처럼 확인 가능한 행동으로 씁니다.',
        "   반드시 미션에서 요구한 핵심 행동만 최소 기준으로 작성합니다.",
        "   각 항목은 다른 항목과 독립적으로 평가할 수 있는 서로 다른 사용자 행동이어야 합니다.",
        "   같은 행동의 표현 예시·동의어·말투 변형을 각각 별도의 필수 성공조건으로 나열하지 말고 하나의 행동 기준으로 합치세요.",
        "   선택 가능한 여러 표현을 모두 수행해야 하는 필수 조건처럼 만들지 마세요.",
        "",
        `3) feedbackFocus — 이후 피드백에서 중점적으로 평가할 관찰 포인트를 최대 ${MAX_METADATA_ITEMS}개 씁니다.`,
        "   성격이나 관계를 단정하지 말고, 사용자의 실제 발화 내용과 발화 순서에서 직접 확인할 항목으로 씁니다.",
        "   successCriteria의 핵심 행동과 직접 연결된 항목만 작성합니다.",
        "",
        `4) flow — 미션 수행을 위해 대화가 거쳐야 할 단계 ${FLOW_STEPS}개. 각 단계는 두 항목으로 씁니다.`,
        '   step: 그 단계에서 상대역이 무엇을 하는지. 예: "가볍게 근황을 물어 편한 분위기 만들기"',
        '   미션의 핵심 행동이 "사용자가 먼저 인사하기", "먼저 질문하기", "먼저 말 걸기"라면 첫 단계에서 상대역 AI가 인사·질문·말 걸기를 먼저 수행하지 마세요.',
        "   이 경우 상대역은 짧게 기다리거나 사용자가 먼저 시작할 수 있는 상황만 열어 주고, 사용자의 과제를 대신 수행하지 않습니다.",
        '   advanceExamples: 이 단계를 지났다고 볼 만한 **사용자의 실제 발화**를 2~3개.',
        '     설명문이 아니라 사용자가 입 밖으로 낼 말 그대로 씁니다.',
        '     ✗ "사용자가 근황을 꺼냄"   ✓ "요즘 시험 준비하느라 바빠"',
        "     상대역의 말이 아니라 **사용자가 할 말**이어야 합니다. 표현이 다양하도록 서로 다르게 씁니다.",
        "",
        `5) responseRules — 자주 나올 상황과 대응 방향 ${RULE_COUNT}개.`,
        '   when: 사용자가 보일 만한 반응을 구체적으로. 예: "무슨 말을 해야 할지 모르겠다고 함"',
        '   then: 상대역이 어느 방향으로 반응할지. 예: "선택지를 좁혀 하나만 물어보기"',
        "   then에는 **할 말을 그대로 쓰지 말고 방향만** 씁니다. 대본이 되면 대화가 딱딱해집니다.",
        "   사용자가 과제를 이미 수행한 상황에 대한 규칙도 반드시 하나 넣으세요.",
        "",
        `- 모든 문장은 ${MAX_LINE_LENGTH}자 이내 한 줄입니다.`,
        "- objective, successCriteria, feedbackFocus, flow.step, flow.advanceExamples, responseRules.when, responseRules.then의 모든 문자열을 문장 중간에서 끊지 마세요.",
        '- 각 문자열은 짧더라도 의미가 완결된 문장 또는 자립 가능한 표현이어야 하며, "후", "하고", "하며", "또는", "및", 조사만 남은 형태처럼 뒤 내용이 필요한 말로 끝내지 마세요.',
        '- 특히 responseRules.then은 "계산 안내 후 "처럼 다음 행동이 빠진 미완성 표현이 아니라, 상대역이 취할 대응 방향을 끝까지 작성하세요.',
        "- 길이 제한에 가까우면 내용을 줄여 완결하고, 문장을 잘라 길이만 맞추지 마세요.",
        "- 반드시 아래 JSON 형식으로만 응답하세요.",
        '{ "objective": "string", "successCriteria": ["string"], "feedbackFocus": ["string"], "flow": [{ "step": "string", "advanceExamples": ["string"] }], "responseRules": [{ "when": "string", "then": "string" }] }',
      ].join("\n"),
    },
    {
      role: "user" as const,
      content: [
        `미션 공통 정보: ${context}`,
        ...(previousViolation
          ? [
              `재생성 보정 지시: 이전 생성 결과가 ${previousViolation.reason} 때문에 거부되었습니다.`,
              `위반 위치: ${previousViolation.field}`,
              `위반 표현 유형: ${previousViolation.term}`,
              "이번에는 대화 텍스트와 발화 순서로 직접 확인 가능한 행동만 사용하세요.",
            ]
          : []),
        "이 미션의 대화 지침을 만들어주세요.",
      ].join("\n\n"),
    },
  ];
};

// 미션별 플레이북 생성. 실패하면 null → 호출부가 플레이북 없이 진행한다(기존 동작 유지).
export const generatePlaybook = async (
  mission: PlaybookMissionContext
): Promise<DialoguePlaybook | null> => {
  let previousViolation: PlaybookRetryCorrection | undefined;
  const parsed = await generateWithRetry(async () => {
    const result = await callUpstageChat(buildPlaybookMessages(mission, previousViolation), {
      temperature: PLAYBOOK_TEMPERATURE,
      maxTokens: PLAYBOOK_MAX_TOKENS,
      jsonMode: true,
    });
    if (!result.ok) {
      logger.warn({ reason: result.reason }, "대화 플레이북 생성 LLM 호출 실패");
      return null;
    }

    const candidate = parseJsonResponse(
      result.content,
      generatedPlaybookSchema,
      "대화 플레이북"
    );
    if (!candidate) return null;

    const observabilityViolation = findPlaybookObservabilityViolation(candidate);
    if (observabilityViolation) {
      logger.warn(observabilityViolation, "대화 플레이북 비관찰 표현 검증 실패");
      previousViolation = {
        ...observabilityViolation,
        reason: "텍스트로 관찰할 수 없는 표현 포함",
      };
      return null;
    }

    const quantitativeViolation = findPlaybookQuantitativeConstraintViolation(candidate, mission);
    if (quantitativeViolation) {
      logger.warn(quantitativeViolation, "대화 플레이북 미션 비근거 정량 조건 검증 실패");
      previousViolation = {
        ...quantitativeViolation,
        reason: "미션 원문에 근거 없는 정량 조건 포함",
      };
      return null;
    }
    return candidate;
  }, { label: "대화 플레이북" });
  if (!parsed) return null;

  return embedPlaybook(parsed);
};

// LLM이 만든(또는 사람이 손으로 고친) 텍스트 플레이북에 임베딩을 붙여 저장 형태로 만든다.
//
// **텍스트를 고쳤으면 반드시 여기를 다시 거쳐야 한다.** 임베딩만 옛 텍스트로 남으면
// 매칭이 조용히 어긋난다 — 겉으로는 정상이라 알아채기 어렵다.
export const embedPlaybook = async (
  parsed: GeneratedPlaybook
): Promise<DialoguePlaybook> => {
  // 규칙의 when과 단계의 예시 발화를 미리 임베딩해 함께 저장한다.
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
    ...(parsed.objective !== undefined ? { objective: parsed.objective } : {}),
    ...(parsed.successCriteria !== undefined
      ? { successCriteria: parsed.successCriteria }
      : {}),
    ...(parsed.feedbackFocus !== undefined ? { feedbackFocus: parsed.feedbackFocus } : {}),
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

// ── CRUD (운영/튜닝용) ──
// 플레이북은 자동 생성되지만, 품질이 나쁘게 나오면 눈으로 보고 손봐야 한다.
// 아래 함수들이 GET/PUT/POST regenerate/DELETE의 실제 동작을 담당한다.

/** 응답용 형태 — 임베딩은 뺀다(4096차원 × 10개라 1MB가 넘고, 사람이 볼 값이 아니다). */
export interface PlaybookView {
  objective?: string;
  successCriteria?: string[];
  feedbackFocus?: string[];
  flow: { step: string; advanceExamples: string[] }[];
  responseRules: { when: string; then: string }[];
  /** 임베딩이 붙어 있는지. false면 단계 진행이 턴 상한으로만 동작한다. */
  hasEmbeddings: boolean;
}

export const toPlaybookView = (playbook: DialoguePlaybook): PlaybookView => ({
  ...(playbook.objective !== undefined ? { objective: playbook.objective } : {}),
  ...(playbook.successCriteria !== undefined
    ? { successCriteria: playbook.successCriteria }
    : {}),
  ...(playbook.feedbackFocus !== undefined ? { feedbackFocus: playbook.feedbackFocus } : {}),
  flow: playbook.flow.map(({ step, advanceExamples }) => ({ step, advanceExamples })),
  responseRules: playbook.responseRules.map(({ when, then }) => ({ when, then })),
  hasEmbeddings:
    playbook.flow.some((s) => (s.advanceEmbeddings?.length ?? 0) > 0) ||
    playbook.responseRules.some((r) => (r.whenEmbedding?.length ?? 0) > 0),
});

/** 사람이 보내는 수정 요청. 임베딩은 받지 않는다 — 서버가 다시 계산한다. */
export const playbookInputSchema = generatedPlaybookSchema;
export type PlaybookInput = z.infer<typeof playbookInputSchema>;
