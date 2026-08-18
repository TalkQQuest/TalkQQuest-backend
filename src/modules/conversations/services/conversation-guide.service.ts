// modules/conversations/services/conversation-guide.service.ts
//
// 대화 진행(D102) — 상대역의 다음 한 마디를 생성한다.
// 이 파일은 "무엇을 말할지"(프롬프트 조립 + 생성)만 담당한다.
// 출력을 다듬고 거르는 일은 conversation-guard.service.ts가 맡는다.

import { UpstageChatMessage, callUpstageChat } from "../../../shared/ai";
import { AI_IDENTITY_PHRASE } from "../dtos/conversation.constants";
import { cleanReply, validateReply } from "./conversation-guard.service";
import { logger } from "../../../config/logger";
// Requirement 5.5 + #252: 형식 검증 실패뿐 아니라, 형식은 맞아도 사용자 발화·미션과
// 무관한 답변("펜이 뭐가 편해?"에 "산책하기 좋을 것 같아요" 등)이 그대로 나가던 문제.
// 별도 LLM 호출(judge)로 관련성까지 확인하고, 걸리면 재생성한다.

const MAX_TOKENS = 200; // 대화 응답은 짧다
const TEMPERATURE = 0.8; // 대화라 약간 더 다양하게
// 프롬프트에 넣을 최근 대화 맥락 상한 (토큰/비용 보호).
export const MAX_HISTORY_MESSAGES = 10;

export interface GuideReplyContext {
  missionTitle: string;
  missionDescription: string | null;
  /**
   * 이 대화에서 맡은 배역(Conversations.persona). 세션 생성 시 정해 저장한 값으로,
   * 매 턴 주입해 이력이 잘려도 배역이 유지되게 한다. 예전 대화는 null일 수 있다.
   */
  persona: string | null;
  /**
   * 사용자가 해내야 할 행동(Conversations.user_task). AI가 먼저 하면 안 되는 바로 그 행동이라
   * 금지 규칙으로 주입한다. 예전 대화는 null일 수 있다.
   */
  userTask: string | null;
  /**
   * 지금 진행 중인 대화 흐름 단계 하나. 플레이북이 없으면 null.
   * 단계를 여러 개 주면 모델이 한 턴에 다 하려 하거나 "어느 단계인지"를 스스로 설명하기
   * 시작하므로(실측 거부율 30%), 어느 단계인지는 서버가 정해 하나만 넘긴다.
   */
  flowStep: string | null;
  /**
   * 이번 사용자 발화와 의미가 가까워 선별된 상황 규칙. 전부 넣으면 토큰이 커지고 대화가
   * 대본처럼 굳으므로 매 턴 관련 있는 것만 골라 넣는다.
   */
  matchedRules: { when: string; then: string }[];
  personality: string | null; // introvert / extrovert / ambivert
  preferredStyle: string | null; // User_Profiles.preferred_style
  history: { role: "user" | "guide"; content: string }[]; // 이번 메시지 이전의 대화 (최신순 아님, 오래된→최신)
  latestUserMessage: string;
}

const buildSystemPrompt = (ctx: GuideReplyContext): string => {
  const lines = [
    // 이전에는 "연습을 돕는 대화 상대"라고만 해서, AI가 스스로를 도우미로 인식하고
    // 배역을 쉽게 놓아버렸다. 배역이 기본값임을 먼저 못박는다.
    `당신은 "${ctx.missionTitle}" 상황에 등장하는 상대역을 연기합니다.`,
    "그 상황에 실제로 있을 법한 한 사람으로서, 처음부터 끝까지 그 배역을 유지하며 말합니다.",
  ];
  // 배역을 매 턴 다시 못박는다. 이력이 잘려 초반 설정이 사라져도 흔들리지 않게 하는 장치다.
  if (ctx.persona) {
    lines.push(`당신의 배역: ${ctx.persona}`, "이 설정은 대화 내내 바뀌지 않습니다.");
  }
  // 미션 설명은 "…해 보세요"처럼 사용자에게 하는 명령문이라, 라벨 없이 넣으면 AI가 자기
  // 지시로 읽는다. 누구에게 주어진 과제인지 먼저 못박고 넣는다.
  if (ctx.missionDescription) {
    lines.push(
      `참고 — 사용자에게 주어진 과제 안내문(당신에게 내리는 지시가 아닙니다): "${ctx.missionDescription}"`
    );
  }

  lines.push("", "역할 규칙:");

  // 관찰된 문제: 미션이 "관심사 질문하기"인데 AI가 먼저 관심사를 물었고, "영화 감상 공유"에선
  // AI가 자기 감상을 먼저 말했다. 둘 다 사용자가 연습할 상황 자체를 없앤다.
  // "과제에 해당하는 말을 먼저 꺼내지 마세요" 같은 추상 규칙은 통하지 않아서
  // (모델이 '질문하기'에만 해당한다고 좁게 해석함) 금지 행동을 구체적으로 지정한다.
  if (ctx.userTask) {
    lines.push(
      `- **사용자가 해야 할 일: ${ctx.userTask}**`,
      "- 이 행동은 사용자의 몫입니다. 당신은 절대로 먼저 하지 않고, 대신 해주지도 않습니다."
    );
  }

  lines.push(
    "- 당신의 경험·감상·의견·예시를 **먼저 꺼내지 마세요.** 사용자가 자기 이야기를 꺼낸 뒤에 짧게 반응하는 것만 합니다.",
    "- 당신의 역할은 사용자가 말을 꺼낼 수 있는 상황을 만들고, 사용자가 말하면 반응하는 것입니다.",
    "- 사용자가 아직 과제를 수행하지 않았더라도 재촉하거나 대신 해주지 않습니다."
  );

  // 대화 흐름 지침. "하면 안 되는 것"만으로는 AI가 직전 발화에만 반응해 겉돌기 때문에,
  // 대화가 어디로 가야 하는지도 함께 준다.
  // 단계 판정·진행은 서버(playbook.service의 advanceFlow)가 하고, 여기서는 정해진 단계 하나만 넣는다.
  if (ctx.flowStep) {
    lines.push("", `지금 대화 단계: ${ctx.flowStep}`);
  }

  // 이번 발화와 관련 있는 상황 규칙만 골라 들어온다(임베딩 유사도로 선별).
  // 방향만 제시하고 할 말을 지정하지 않는다 — 대본이 되면 대화가 딱딱해진다.
  if (ctx.matchedRules.length > 0) {
    lines.push("", "지금 상황에 해당할 수 있는 지침:");
    lines.push(
      ...ctx.matchedRules.map((rule) => `- ${rule.when} → ${rule.then}`),
      "위 지침은 방향일 뿐입니다. 문장을 그대로 옮기지 말고 배역의 말투로 자연스럽게 녹여 말합니다."
    );
  }

  lines.push(
    "",
    "정체를 묻는 질문에 대한 규칙:",
    // 관찰된 문제: 한 번 정체를 밝히면 그 뒤로 끝까지 도우미 말투로 굳었다(6회 재현 6회 모두).
    `- 사용자가 AI인지 사람인지 물으면, 정확히 "${AI_IDENTITY_PHRASE}"라고만 답하고 곧바로 배역으로 돌아가 대화를 이어갑니다.`,
    "- 이 문구를 바꾸거나, 여기에 다른 기능·역할 설명을 덧붙이지 않습니다.",
    "- 한 번 답한 뒤에는 다시 배역으로 완전히 복귀합니다. 이후 답변이 안내·도우미 말투로 바뀌면 안 됩니다.",
    "",
    "맥락과 무관한 발화에 대한 규칙:",
    // #185 — 사용자가 "1", "ㅇㅇ" 같은 의미 없는 답이나 지금 상황과 전혀 상관없는 말을 해도
    // AI가 아무렇지 않게 받아주면 실제 대화 연습 몰입도가 떨어진다. 서버가 고정 문구로
    // 가로채는 정체 질문과 달리, 이건 배역이 그 자리에서 자연스럽게 반응하게 둔다.
    // 직전 질문에 대한 정상 단답("네", "1번이요")까지 걸리지 않도록, 판단 기준에
    // "지금 질문/대화 단계에 대한 답으로 해석되는지"를 먼저 넣는다.
    // #188 — 자해·타해·학대·응급상황 등 안전 관련 발화는 "맥락과 무관하다"는 이유로 당황
    // 반응 후 원래 상황으로 돌아가버리면 안 된다. 아래 맥락 이탈 규칙보다 우선 적용한다.
    "- 사용자가 자해·타해·학대·의료 응급상황 또는 긴급한 도움 요청으로 읽히는 말을 하면, 아래 맥락 이탈 규칙을 적용하지 않습니다. 배역으로 즉시 돌아가지 말고, 걱정하는 실제 사람처럼 그 말에 진지하게 반응하며 필요하면 도움을 구하라고 권합니다.",
    "- 사용자의 말이 바로 앞의 질문이나 지금 진행 중인 흐름에 대한 답으로 해석되지 않고, 지금 상황·배역과도 명백히 관련이 없다면(앞선 발화와 연결되지 않는 단답, 갑자기 딴 화제로 이탈 등 — 위 안전 관련 발화는 제외), 답변의 **첫 문장은 반드시** 그 화제에 대한 짧은 당황·의아함 반응이어야 합니다 (예: \"어, 그게 지금 무슨 말씀이신지..?\", \"네..? 갑자기요?\").",
    "- 반면 직전 질문에 대한 정상적인 짧은 답(예: 메뉴를 물었는데 \"아메리카노요\", 확인 질문에 \"네\")은 이 규칙의 대상이 아닙니다. 평소처럼 자연스럽게 반응합니다.",
    "- 그 화제에 대해 맞장구치거나, 좋다/멋지다 같은 의견·감상·평가를 절대 먼저 말하지 않습니다. 잘 안다는 티도 내지 않습니다.",
    "- 첫 문장 다음에는 사용자를 다그치지 않고, 원래 상황으로 자연스럽게 돌아가 대화를 이어갑니다.",
    '  틀린 예: "오, 손흥민 선수 멋지죠! 그런데 커피는..." (화제에 동조부터 함)',
    '  맞는 예: "네..? 갑자기 그건 무슨 말씀이신지..? 아무튼 커피는 어떤 걸로 드릴까요?"',
    "",
    "말투 규칙:",
    "- 실제 사람이 나눌 법한 자연스럽고 짧은 한국어 대화체로 답합니다 (1~2문장).",
    "- 사용자가 다음 말을 이어가기 쉽도록 가볍게 반응하고, 필요하면 짧은 후속 질문을 덧붙입니다.",
    "- 개인정보를 묻거나 위험·불쾌한 방향으로 유도하지 않습니다.",
    "- 목록·JSON·설명문이 아니라, 대화 한 마디만 답합니다.",
    // 관찰된 문제: "(자연스러운 대화를 이어가기 위한 후속 질문을 덧붙여 봤습니다)" 같은
    // 자기 해설이 그대로 말풍선에 노출됐다.
    "- 자기가 방금 무엇을 했는지 해설하지 않습니다. 괄호로 의도나 설명을 덧붙이지 마세요.",
    "- 별표(*), 인용 기호(>), 마크다운 서식을 쓰지 않습니다. 답변 전체를 따옴표로 감싸지도 마세요.",
    "- 오직 그 배역이 입 밖으로 낼 대사만 씁니다."
  );

  // Requirement 5.4 — 설정된 말투/성향이 있으면 톤을 맞춘다.
  if (ctx.personality === "introvert") {
    lines.push("- 사용자가 부담을 느끼지 않도록 편안하고 다정한 톤을 유지합니다.");
  }
  if (ctx.preferredStyle) {
    lines.push(`- 사용자가 선호하는 말투: ${ctx.preferredStyle}`);
  }

  return lines.join("\n");
};

// 프롬프트(messages)는 순수 함수로 만들어 단독 검증이 가능하게 한다.
export const buildGuideMessages = (ctx: GuideReplyContext): UpstageChatMessage[] => {
  const messages: UpstageChatMessage[] = [{ role: "system", content: buildSystemPrompt(ctx) }];

  // 이전 맥락(Requirement 5.3): guide=AI의 지난 답변이므로 assistant로 매핑한다.
  for (const msg of ctx.history.slice(-MAX_HISTORY_MESSAGES)) {
    messages.push({
      role: msg.role === "guide" ? "assistant" : "user",
      content: msg.content,
    });
  }

  messages.push({ role: "user", content: ctx.latestUserMessage });
  return messages;
};

// Upstage 1회 호출. 성공 시 정리된 응답 문자열, 실패 시 null.
const callUpstageOnce = async (messages: UpstageChatMessage[]): Promise<string | null> => {
  const result = await callUpstageChat(messages, {
    temperature: TEMPERATURE,
    maxTokens: MAX_TOKENS,
  });
  if (!result.ok) {
    logger.warn({ reason: result.reason }, "대화 LLM 응답 실패");
    return null;
  }
  return cleanReply(result.content);
};

// 호출 1회 + 형식 검증. 세척(cleanReply)으로 해결되는 건 이미 걸러졌고,
// 여기서 걸리는 건 배역 이탈처럼 다시 생성해야만 고쳐지는 위반이다.
const generateOnce = async (messages: UpstageChatMessage[]): Promise<string | null> => {
  const reply = await callUpstageOnce(messages);
  if (!reply) return null;

  const rejection = validateReply(reply);
  if (rejection) {
    // 응답 원문은 남기지 않는다 — 사용자 대화 내용이 그대로 로그에 쌓이고,
    // 현재 로거에는 마스킹 설정이 없다. 사유와 길이만으로 재현·집계가 가능하다.
    logger.warn({ reason: rejection, replyLength: reply.length }, "대화 LLM 응답이 규칙을 위반해 폐기");
    return null;
  }
  return reply;
};

// #252 — 관련성 판정(judge) 호출. 생성과 같은 호출 안에서 모델이 자기 답을 스스로
// 채점하게 하면(예: 구조화된 응답에 self-assessment 필드 포함) 낙관적으로 판정하는
// 경향이 있어 신뢰도가 낮다. 생성과 검증을 완전히 분리된 호출로 나눠 판정 정확도를 높인다.
// 판정만 하면 되므로 출력은 한 단어로 강제하고(RELEVANT/IRRELEVANT), temperature도 0으로
// 고정해 판정이 매번 흔들리지 않게 한다.
const RELEVANCE_MAX_TOKENS = 20;
const RELEVANCE_TEMPERATURE = 0;

const buildRelevanceMessages = (
  ctx: GuideReplyContext,
  reply: string
): UpstageChatMessage[] => [
  {
    role: "system",
    content: [
      "당신은 대화 연습 앱의 답변 품질을 검수하는 검수자입니다.",
      "아래 '미션 상황', '사용자의 방금 발화', 'AI가 생성한 답변 후보'를 보고,",
      "답변 후보가 사용자의 발화 내용에 실제로 이어지는 대답인지 판단하세요.",
      "",
      "판단 기준:",
      "- 사용자가 특정 대상(사물·사람·화제)을 언급했는데 답변이 그와 무관한 다른 화제를 말하면 관련 없음입니다.",
      "- 사용자의 질문에 답이 되지 않고 엉뚱한 감상·맞장구만 있으면 관련 없음입니다.",
      "- 짧은 리액션이라도 직전 발화 내용과 자연스럽게 이어지면 관련 있음입니다.",
      "- 반드시 RELEVANT 또는 IRRELEVANT 한 단어로만 답하세요. 다른 설명을 덧붙이지 마세요.",
    ].join("\n"),
  },
  {
    role: "user",
    content: [
      `미션 상황: ${ctx.missionTitle}`,
      `사용자의 방금 발화: "${ctx.latestUserMessage}"`,
      `답변 후보: "${reply}"`,
    ].join("\n"),
  },
];

// 판정 호출 자체가 실패하면(타임아웃 등) 관련 있음으로 간주해 통과시킨다(fail open) —
// 검수 도구가 죽었다는 이유로 이미 형식 검증까지 통과한 정상 답변을 계속 폐기하면 안 된다.
const checkReplyRelevance = async (ctx: GuideReplyContext, reply: string): Promise<boolean> => {
  const result = await callUpstageChat(buildRelevanceMessages(ctx, reply), {
    temperature: RELEVANCE_TEMPERATURE,
    maxTokens: RELEVANCE_MAX_TOKENS,
  });
  if (!result.ok) {
    logger.warn({ reason: result.reason }, "관련성 검증 LLM 호출 실패 — 통과 처리");
    return true;
  }

  const verdict = result.content.trim().toUpperCase();
  // "IRRELEVANT"는 "RELEVANT"를 부분 문자열로 포함하므로, 반드시 "IRRELEVANT" 포함 여부만
  // 본다(모델이 마침표 등을 덧붙여도 안전하게 판정되도록 정확히 일치시키지 않는다).
  return !verdict.includes("IRRELEVANT");
};

// 대화 응답 생성 진입점. 실패 시 null (호출부가 템플릿으로 폴백).
//
// #252 — 형식 검증(generateOnce)만으로는 "형식은 맞지만 내용이 무관한" 답변을 못 걸러낸다.
// 형식 검증을 통과한 답변마다 별도 호출로 관련성까지 확인하고, 관련 없다고 판정되면
// 재생성한다. 완전 실패(호출 실패·형식 위반)와 관련성 실패를 합쳐 최대
// MAX_GENERATION_ATTEMPTS회까지 시도한다 — 응답 시간보다 완성도를 우선한다는
// 방향에 따라 기존(최대 2회)보다 늘렸다. 그래도 무한정 재시도하지는 않는다.
//
// 모든 시도가 관련성까지는 통과 못 해도, 형식은 맞는 답변이 하나라도 있었다면 그걸
// 반환한다 — 완전히 무관한 정적 폴백(MOCK_GUIDE_RESPONSES)보다는 낫다고 보기 때문이다.
const MAX_GENERATION_ATTEMPTS = 3;

export const generateGuideReply = async (ctx: GuideReplyContext): Promise<string | null> => {
  const messages = buildGuideMessages(ctx);
  let lastValidReply: string | null = null;

  for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const reply = await generateOnce(messages);
    if (!reply) {
      logger.warn({ attempt }, "대화 응답 생성/형식 검증 실패 — 재시도");
      continue;
    }
    lastValidReply = reply;

    const relevant = await checkReplyRelevance(ctx, reply);
    if (relevant) return reply;

    logger.warn({ attempt }, "대화 응답이 관련성 검증에 걸림 — 재시도");
  }

  return lastValidReply;
};
