// modules/conversations/services/conversation-guide.service.ts
//
// 대화 진행(D102) — 상대역의 다음 한 마디를 생성한다.
// 이 파일은 "무엇을 말할지"(프롬프트 조립 + 생성)만 담당한다.
// 출력을 다듬고 거르는 일은 conversation-guard.service.ts가 맡는다.

import { UpstageChatMessage, callUpstageChat, generateWithRetry } from "../../../shared/ai";
import { AI_IDENTITY_PHRASE } from "../dtos/conversation.constants";
import { cleanReply, validateReply } from "./conversation-guard.service";
import { logger } from "../../../config/logger";
// Requirement 5.5: 1회 재시도 후에도 실패하면 폴백.

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
  /** 이 미션의 대화 흐름 단계(Missions.dialogue_playbook.flow). 없으면 흐름 지침 없이 진행한다. */
  flow: string[];
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
  if (ctx.flow.length > 0) {
    lines.push("", "대화 흐름 (순서대로 진행하되, 사용자 속도에 맞춥니다):");
    lines.push(...ctx.flow.map((step, i) => `${i + 1}. ${step}`));
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

// 호출 1회 + 출력 검증. 세척(cleanReply)으로 해결되는 건 이미 걸러졌고,
// 여기서 걸리는 건 배역 이탈처럼 다시 생성해야만 고쳐지는 위반이다.
const generateOnce = async (messages: UpstageChatMessage[]): Promise<string | null> => {
  const reply = await callUpstageOnce(messages);
  if (!reply) return null;

  const rejection = validateReply(reply);
  if (rejection) {
    logger.warn({ reason: rejection, reply }, "대화 LLM 응답이 규칙을 위반해 폐기");
    return null;
  }
  return reply;
};

// 대화 응답 생성 진입점. 실패 시 null (호출부가 템플릿으로 폴백).
// Requirement 5.5 — 최초 시도 + 실패 시 1회 재시도. 호출 실패뿐 아니라
// "규칙을 어긴 답변"도 재시도 대상이라 generateOnce가 검증까지 마친 뒤 null/값을 돌려준다.
export const generateGuideReply = (ctx: GuideReplyContext): Promise<string | null> => {
  const messages = buildGuideMessages(ctx);
  return generateWithRetry(() => generateOnce(messages), { label: "대화 응답" });
};
