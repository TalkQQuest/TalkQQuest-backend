import { logger } from "../../../config/logger";
import { callUpstageChat, UpstageChatMessage } from "../../../shared/llm/upstage";

// 대화 진행(D102)용 LLM 응답 생성.
// 미션 추천(mission/llm.service)과 달리 멀티턴 맥락을 유지하고 자연어 한 마디만 생성한다.
// 실패(키 없음/HTTP 오류/타임아웃/빈 응답)하면 null을 반환해 호출부가 템플릿 폴백으로 넘어가게 한다.
// Requirement 5.5: 1회 재시도 후에도 실패하면 폴백.

const MAX_TOKENS = 200; // 대화 응답은 짧다
const TEMPERATURE = 0.8; // 대화라 약간 더 다양하게
// 프롬프트에 넣을 최근 대화 맥락 상한 (토큰/비용 보호).
export const MAX_HISTORY_MESSAGES = 10;

export interface GuideReplyContext {
  missionTitle: string;
  missionDescription: string | null;
  personality: string | null; // introvert / extrovert / ambivert
  preferredStyle: string | null; // User_Profiles.preferred_style
  history: { role: "user" | "guide"; content: string }[]; // 이번 메시지 이전의 대화 (최신순 아님, 오래된→최신)
  latestUserMessage: string;
}

const buildSystemPrompt = (ctx: GuideReplyContext): string => {
  const lines = [
    "당신은 사용자가 실제 사회적 대화를 연습하도록 돕는 대화 상대입니다.",
    `사용자는 지금 "${ctx.missionTitle}" 미션을 연습하고 있습니다.`,
  ];
  if (ctx.missionDescription) {
    lines.push(`미션 설명: ${ctx.missionDescription}`);
  }

  lines.push(
    "",
    "규칙:",
    "- 실제 사람이 나눌 법한 자연스럽고 짧은 한국어 대화체로 답합니다 (1~2문장).",
    "- 사용자가 다음 말을 이어가기 쉽도록 가볍게 반응하고, 필요하면 짧은 후속 질문을 덧붙입니다.",
    "- 개인정보를 묻거나 위험·불쾌한 방향으로 유도하지 않습니다.",
    "- 목록·JSON·설명문이 아니라, 대화 한 마디만 답합니다."
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

// 모델이 응답을 따옴표로 감싸는 경우를 벗겨낸다.
const cleanReply = (raw: string): string =>
  raw
    .trim()
    .replace(/^["'“”]+/, "")
    .replace(/["'“”]+$/, "")
    .trim();

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

// 대화 응답 생성 진입점. 실패 시 null (호출부가 템플릿으로 폴백).
export const generateGuideReply = async (ctx: GuideReplyContext): Promise<string | null> => {
  const messages = buildGuideMessages(ctx);

  // Requirement 5.5 — 최초 시도 + 실패 시 1회 재시도.
  const first = await callUpstageOnce(messages);
  if (first) return first;

  logger.warn("대화 LLM 1차 실패 — 재시도");
  const retry = await callUpstageOnce(messages);
  if (retry) return retry;

  logger.warn("대화 LLM 재시도까지 실패 — 템플릿으로 폴백");
  return null;
};
