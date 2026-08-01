import { logger } from "../../../config/logger";
import { callUpstageChat, UpstageChatMessage } from "../../../shared/llm/upstage";
import { validateReply } from "./conversation-guard.service";
import { AI_IDENTITY_PHRASE, buildOpeningMessage } from "../dtos/conversation.constants";

// 기존 import 경로를 유지하기 위한 재수출.
export { AI_IDENTITY_PHRASE, buildOpeningMessage };

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
  /**
   * 이 대화에서 맡은 배역(Conversations.persona). 세션 생성 시 정해 저장한 값으로,
   * 매 턴 주입해 이력이 잘려도 배역이 유지되게 한다. 예전 대화는 null일 수 있다.
   */
  persona: string | null;
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
  if (ctx.missionDescription) {
    lines.push(`상황 설명: ${ctx.missionDescription}`);
  }

  lines.push(
    "",
    "역할 규칙:",
    // 관찰된 문제: 미션이 "관심사 질문하기"인데 AI가 먼저 관심사를 물어 사용자가 미션을
    // 수행할 상황 자체가 사라졌다.
    "- 위 상황 설명은 **사용자가 연습할 과제**입니다. 당신의 할 일이 아닙니다. 과제에 해당하는 말(예: 상대의 관심사를 묻기)을 당신이 먼저 꺼내지 마세요. 사용자가 그 말을 꺼낼 수 있도록 자연스러운 상황만 만들어 주세요.",
    "- 사용자가 아직 과제를 수행하지 않았더라도 재촉하거나 대신 해주지 않습니다.",
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

const QUOTE_CHARS = `"'“”「」『』`;

// 프롬프트로 막아도 새는 경우가 있어 후처리로 한 번 더 걷어낸다.
// 여기서 지우는 것들은 전부 실제로 사용자 말풍선에 노출된 적이 있는 형태다.
export const cleanReply = (raw: string): string => {
  let text = raw.trim();

  // 1) 자기 해설 괄호 제거.
  //    예: "저는 …예요! (자연스러운 대화를 이어가기 위한 후속 질문을 덧붙여 봤습니다) 혹시 …?"
  //    감정·행동 묘사((웃음) 등)까지 지우지 않도록, 해설로 보이는 서술형 어미로 끝나는
  //    긴 괄호만 대상으로 한다.
  text = text.replace(/\s*[(（][^)）]{10,}?(?:습니다|했어요|봤습니다|입니다)[)）]/g, "");

  // 2) 줄머리 인용 기호와 마크다운 강조 제거.
  text = text
    .replace(/^\s*>+\s?/gm, "")
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1")
    .replace(/^#{1,6}\s+/gm, "");

  // 3) 답변 전체를 감싼 따옴표 제거.
  //    이전 구현은 문자열 끝에서만 닫는 따옴표를 찾아, `...하시나요?" 😊`처럼 뒤에 이모지가
  //    붙으면 못 걷어냈다(실제 발생). 뒤쪽 공백·이모지 등 비따옴표 꼬리를 건너뛰고 검사한다.
  text = stripWrappingQuotes(text);

  return text.replace(/[ \t]{2,}/g, " ").trim();
};

// 여는 따옴표가 맨 앞에 있을 때, 뒤쪽 꼬리(이모지·공백 등)를 남기고 감싼 따옴표만 제거한다.
const stripWrappingQuotes = (text: string): string => {
  const opensWithQuote = QUOTE_CHARS.includes(text[0] ?? "");

  // 끝에서부터 따옴표가 아닌 꼬리(이모지·공백·문장부호)를 건너뛰어 닫는 따옴표 위치를 찾는다.
  let end = text.length - 1;
  while (end >= 0 && !QUOTE_CHARS.includes(text[end])) end -= 1;
  const closingFound = end > 0;

  if (opensWithQuote && closingFound) {
    // 정상적으로 감싼 경우: 양쪽 따옴표만 떼고 꼬리는 살린다.
    return (text.slice(1, end) + text.slice(end + 1)).trim();
  }
  if (opensWithQuote) {
    return text.slice(1).trim();
  }
  if (closingFound && !text.slice(0, end).includes('"')) {
    // 여는 따옴표 없이 닫는 것만 남은 경우(실제 보고된 형태). 짝이 없으므로 그것만 제거한다.
    return (text.slice(0, end) + text.slice(end + 1)).trim();
  }
  return text;
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

// ── 배역 생성 (세션 생성 시 1회) ──
// 미션 제목만으로는 매 턴 다른 사람이 말하는 것처럼 흔들려서, 구체적인 배역을 한 번 정해 굳힌다.

const PERSONA_MAX_TOKENS = 60;
const PERSONA_MAX_LENGTH = 100; // Conversations.persona가 VARCHAR(255)라 넉넉히 잡아도 안전

// 형식이 어긋나면(설명문·여러 줄) 저장하지 않는다. 배역은 매 턴 프롬프트에 들어가므로
// 여기에 잡소리가 섞이면 모든 턴이 오염된다.
const isValidPersona = (text: string): boolean =>
  text.length > 0 && text.length <= PERSONA_MAX_LENGTH && !text.includes("\n");

// 미션 상황에 맞는 배역 한 줄을 만든다. 실패하면 null → 호출부가 배역 없이 진행한다.
export const generatePersona = async (
  missionTitle: string,
  missionDescription: string | null
): Promise<string | null> => {
  const context = missionDescription
    ? `상황: ${missionTitle}\n설명: ${missionDescription}`
    : `상황: ${missionTitle}`;

  const result = await callUpstageChat(
    [
      {
        role: "system",
        content: [
          "당신은 대화 연습 앱의 배역을 정하는 도우미입니다.",
          "주어진 상황에서 사용자의 대화 상대가 될 인물을 한 줄로 정의하세요.",
          "",
          "규칙:",
          "- 나이대/관계/말투가 드러나는 짧은 한 줄로 씁니다. 예: \"동아리 1년차 선배, 친근한 존댓말\"",
          `- ${PERSONA_MAX_LENGTH}자 이내, 한 줄로만 씁니다.`,
          "- 이름은 짓지 않습니다. 설명·따옴표·머리기호 없이 배역만 씁니다.",
        ].join("\n"),
      },
      { role: "user", content: `${context}\n\n이 상황의 상대역을 한 줄로 정해주세요.` },
    ],
    { temperature: 0.7, maxTokens: PERSONA_MAX_TOKENS }
  );

  if (!result.ok) {
    logger.warn({ reason: result.reason }, "배역 생성 LLM 호출 실패 — 배역 없이 진행");
    return null;
  }

  const persona = cleanReply(result.content).split("\n")[0]?.trim() ?? "";
  return isValidPersona(persona) ? persona : null;
};

// ── 추천 답변 생성 (GET /conversations/{id}/suggestions) ──
// 예전에는 서버에 하드코딩된 문장을 돌려줘 대화 맥락과 무관한 추천이 나갔다
// (카페 주문 중에 "평소에도 산책 자주 하세요?"). 지금 대화를 보고 생성한다.

const SUGGESTION_COUNT = 3;
const SUGGESTION_MAX_TOKENS = 200;
const SUGGESTION_TEMPERATURE = 0.9; // 매번 같은 추천이 나오지 않도록 조금 더 다양하게

export interface SuggestionContext {
  missionTitle: string;
  missionDescription: string | null;
  history: { role: "user" | "guide"; content: string }[];
}

export const buildSuggestionMessages = (ctx: SuggestionContext): UpstageChatMessage[] => {
  const transcript = ctx.history
    .slice(-MAX_HISTORY_MESSAGES)
    .map((m) => `${m.role === "user" ? "나" : "상대"}: ${m.content}`)
    .join("\n");

  const lines = [
    "당신은 대화 연습 중인 사용자에게 다음에 할 말을 추천하는 도우미입니다.",
    `사용자의 연습 과제: ${ctx.missionTitle}`,
  ];
  if (ctx.missionDescription) {
    lines.push(`과제 설명: ${ctx.missionDescription}`);
  }
  lines.push(
    "",
    "규칙:",
    `- 지금 대화 흐름에서 **사용자가** 바로 말할 수 있는 문장을 정확히 ${SUGGESTION_COUNT}개 제안합니다.`,
    "- 상대가 방금 한 말에 자연스럽게 이어져야 합니다. 맥락과 무관한 일반 문장은 안 됩니다.",
    "- 한 문장씩, 짧고 실제 말하기 쉬운 구어체로 씁니다.",
    "- 번호·불릿·따옴표·설명을 붙이지 말고, 문장만 한 줄에 하나씩 씁니다."
  );

  return [
    { role: "system", content: lines.join("\n") },
    {
      role: "user",
      content: transcript
        ? `지금까지의 대화:\n${transcript}\n\n제가 다음에 할 말을 추천해주세요.`
        : "아직 대화가 시작되지 않았습니다. 제가 먼저 건넬 말을 추천해주세요.",
    },
  ];
};

// 추천 문장 하나가 쓸 만한 형식인지. 사용자가 그대로 눌러 보내는 문장이라
// 서식·설명문이 섞이면 그대로 대화에 들어가므로 버린다.
const SUGGESTION_MAX_LENGTH = 60;
const isValidSuggestion = (line: string): boolean => {
  if (line.length === 0 || line.length > SUGGESTION_MAX_LENGTH) return false;
  if (/^\s*(?:[-*•>#]|\d+[.)])/.test(line)) return false;
  if (/[*_`]/.test(line)) return false;
  // 해설 괄호("~를 물어봅니다" 같은 설명)가 섞인 경우.
  if (/[(（][^)）]{10,}[)）]/.test(line)) return false;
  return true;
};

// 줄 단위 응답을 문장 배열로 정리한다. 모델이 번호를 붙이는 경우가 있어 함께 걷어낸다.
const parseSuggestions = (raw: string): string[] =>
  raw
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .map((line) => cleanReply(line))
    .filter(isValidSuggestion)
    .slice(0, SUGGESTION_COUNT);

// 추천 답변 생성. 실패하거나 결과가 비면 null → 호출부가 템플릿으로 폴백한다.
export const generateSuggestions = async (ctx: SuggestionContext): Promise<string[] | null> => {
  const result = await callUpstageChat(buildSuggestionMessages(ctx), {
    temperature: SUGGESTION_TEMPERATURE,
    maxTokens: SUGGESTION_MAX_TOKENS,
  });
  if (!result.ok) {
    logger.warn({ reason: result.reason }, "추천 답변 LLM 호출 실패");
    return null;
  }

  const suggestions = parseSuggestions(result.content);
  return suggestions.length > 0 ? suggestions : null;
};

// 호출 1회 + 출력 검증. 규칙을 어긴 답변은 받아들이지 않는다.
// 세척(cleanReply)으로 해결되는 건 이미 걸러졌고, 여기서 걸리는 건 배역 이탈처럼
// 다시 생성해야만 고쳐지는 위반이다.
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
export const generateGuideReply = async (ctx: GuideReplyContext): Promise<string | null> => {
  const messages = buildGuideMessages(ctx);

  // Requirement 5.5 — 최초 시도 + 실패 시 1회 재시도.
  // 호출 실패뿐 아니라 "규칙을 어긴 답변"도 재시도 대상이다.
  const first = await generateOnce(messages);
  if (first) return first;

  logger.warn("대화 LLM 1차 실패 — 재시도");
  const retry = await generateOnce(messages);
  if (retry) return retry;

  logger.warn("대화 LLM 재시도까지 실패 — 템플릿으로 폴백");
  return null;
};
