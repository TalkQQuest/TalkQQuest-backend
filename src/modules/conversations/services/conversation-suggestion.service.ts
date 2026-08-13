// modules/conversations/services/conversation-suggestion.service.ts
//
// GET /conversations/{id}/suggestions — 사용자가 다음에 할 말 추천.
// 상대역 답변(conversation-guide)과 달리 **사용자 입장**의 문장을 만든다는 점이 다르다.

import { UpstageChatMessage, callUpstageChat, parseLineList } from "../../../shared/ai";
import { cleanReply } from "./conversation-guard.service";
import { MAX_HISTORY_MESSAGES } from "./conversation-guide.service";
import { logger } from "../../../config/logger";

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
    // #222 — 카페 주문 미션 등에서 "오늘 특별히 사과 시나몬 라떼가 한정으로 나왔어" 같은
    // 상대(점원 등) 역할의 안내·판매 대사가 사용자 추천 답변으로 섞여 나온 사례가 있었다.
    // 그대로 눌러 보내면 role: user로 저장되므로 명시적으로 금지한다.
    "- 절대 상대 역할(점원, 상담원 등)의 대사를 만들지 않습니다. 메뉴 소개, 안내, 제안처럼 상대가 할 법한 말은 제안하지 않고, 반드시 사용자가 상대에게 하는 말(질문, 요청, 대답, 반응)만 제안합니다.",
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

// #222 — 프롬프트 지시만으로는 LLM이 상대 역할(점원 등)의 안내·판매 대사를 만드는 걸 완전히
// 막지 못했다("오늘 특별히 사과 시나몬 라떼가 한정으로 나왔어" 등). bestSentence처럼 후보
// 목록에서 고르게 해서 구조적으로 차단할 수는 없는 상황(추천은 대화에 없던 새 문장이라)이라,
// 상대(점원 등)가 뭔가를 소개·안내·제공한다고 말할 때 쓰는 전형적인 어미 패턴을 걸러낸다.
// 완벽하진 않지만, 이런 어미는 사용자가 스스로에게 하는 말로는 거의 나오지 않는다.
const PROVIDER_OFFERING_PATTERN = /(나왔(어요?|습니다)|준비(했|돼)(어요?|습니다)|해드릴게요)/;
const isRoleConsistentSuggestion = (line: string): boolean => !PROVIDER_OFFERING_PATTERN.test(line);

const isValidSuggestion = (line: string): boolean => {
  if (line.length === 0 || line.length > SUGGESTION_MAX_LENGTH) return false;
  if (/^\s*(?:[-*•>#]|\d+[.)])/.test(line)) return false;
  if (/[*_`]/.test(line)) return false;
  // 해설 괄호("~를 물어봅니다" 같은 설명)가 섞인 경우.
  if (/[(（][^)）]{10,}[)）]/.test(line)) return false;
  if (!isRoleConsistentSuggestion(line)) return false;
  return true;
};

// 줄 단위 파싱·머리기호 정리는 공통 헬퍼가 처리한다. 여기서는 형식 판단만 맡는다.
// cleanReply를 한 번 더 태우는 이유: 모델이 문장 단위로도 따옴표·서식을 붙이는 경우가 있다.
const parseSuggestions = (raw: string): string[] =>
  parseLineList(raw, { limit: SUGGESTION_COUNT, isValid: isValidSuggestion }).map(cleanReply);

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
  // 형식 검증에 걸려 일부만 남으면 화면이 1~2개만 받는다. 그 상태로 내보내면 호출부의
  // 템플릿 폴백을 건너뛰므로, 개수를 못 채우면 실패로 보고 폴백에 맡긴다.
  return suggestions.length === SUGGESTION_COUNT ? suggestions : null;
};