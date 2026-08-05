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

// 호출 1회 + 출력 검증. 규칙을 어긴 답변은 받아들이지 않는다.
// 세척(cleanReply)으로 해결되는 건 이미 걸러졌고, 여기서 걸리는 건 배역 이탈처럼