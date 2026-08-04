// modules/conversations/services/conversation-guard.service.ts
//
// 대화 응답의 가드레일. 프롬프트만으로는 막히지 않던 두 가지를 결정론적으로 처리한다.
//
//  1) 정체 질문 인터셉트 — "너 정체가 뭐야?" 류는 LLM을 아예 부르지 않고 고정 문구로 답한다.
//     LLM에 맡겼을 때 자기소개가 매번 달랐고("대화 연습을 돕는 AI" / "동아리 활동을 돕는 AI
//     도우미" 등 앱에 없는 기능까지 설명), 한 번 답하면 그 뒤로 도우미 말투로 굳었다.
//     서버가 직접 답하면 일관성이 100% 보장되고 LLM 호출 비용·지연도 없다.
//
//  2) 출력 검증 — 생성된 답변이 규칙을 어기면 받아들이지 않고 재시도한다.
//     cleanReply가 "세척"이라면 여기는 "거부"다. 세척으로 지울 수 없는 위반(배역 이탈,
//     장황함)을 걸러낸다.
//
// NeMo-Guardrails가 주는 "정형 의도 → 고정 응답"을 외부 프레임워크·임베딩 없이 구현한 것이다.
// 정규식으로 부족해지면 이 파일의 matchesIdentityQuestion만 임베딩 유사도로 교체하면 된다.

import { AI_IDENTITY_PHRASE } from "../dtos/conversation.constants";

// 사용자가 상대의 정체를 묻는 패턴. 실제 보고된 질문("너 정체가 뭐야? 사람이야 AI야?")과
// 그 변형을 포괄한다. 2인칭 지칭 + 정체를 묻는 표현이 함께 있을 때만 잡아 오탐을 줄인다.
const SECOND_PERSON = /(너|넌|니|당신|그쪽|본인|여기)/;
const IDENTITY_PROBE =
  /(정체|누구(야|세요|시죠|신가요)|뭐야|뭐예요|뭐니|사람이(야|에요|예요|세요)|인간이(야|에요)|ai(야|에요|예요|입니까|인가요)?|에이아이|인공지능|챗봇|봇이(야|에요)|로봇|기계)/i;

// 2인칭 없이도 명백히 정체를 묻는 표현.
const DIRECT_IDENTITY_PROBE =
  /(사람이야|사람이에요|사람인가요|ai야|ai예요|ai인가요|챗봇이야|챗봇인가요|인공지능이야|인공지능인가요|진짜 사람)/i;

export const matchesIdentityQuestion = (message: string): boolean => {
  const text = message.trim().toLowerCase();
  if (text.length === 0) return false;
  if (DIRECT_IDENTITY_PROBE.test(text)) return true;
  return SECOND_PERSON.test(text) && IDENTITY_PROBE.test(text);
};

// 정체 질문에 대한 서버 고정 응답. 고정 문구로 답한 뒤 곧바로 배역으로 돌아간다(B안).
// personaHint가 있으면 어떤 배역으로 돌아가는지까지 알려 복귀를 분명히 한다.
export const buildIdentityResponse = (personaHint: string | null): string => {
  const back = personaHint
    ? `자, 다시 ${personaHint}(으)로 이야기 이어갈게요!`
    : "자, 다시 이야기 이어갈게요!";
  return `${AI_IDENTITY_PHRASE} ${back}`;
};

// ── 출력 세척 ──
// 프롬프트로 막아도 새는 서식을 후처리로 걷어낸다. 여기서 지우는 것들은 전부 실제로
// 사용자 말풍선에 노출된 적이 있는 형태다. (세척으로 못 고치는 위반은 아래 validateReply가 거부한다.)

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

  // 4) 줄바꿈을 공백으로 합친다.
  //    답변은 말풍선 하나에 그대로 들어가는데, 모델이 한 마디 안에서 줄을 나눠 보내는 경우가
  //    있어("여기 커피 괜찮은데 \n우리 스터디 자료는…") 그대로 두면 말풍선이 어색하게 쪼개진다.
  //    2)에서 줄머리 기호를 지운 뒤에 합쳐야 기호가 문장 중간에 남지 않는다.
  text = text.replace(/\s*[\r\n]+\s*/g, " ");

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

// ── 출력 검증 ──

export type ReplyRejectionReason =
  | "empty"
  | "identity_drift" // 고정 문구가 아닌 형태로 AI/도우미 정체를 언급
  | "format_leak" // 세척 후에도 남은 마크다운·해설 괄호
  | "too_long"; // 1~2문장 규칙을 크게 벗어남

// AI·도우미 정체를 가리키는 표현. 이 단어가 보이면 정확히 고정 문구여야 한다.
const AI_SELF_REFERENCE = /(ai|에이아이|인공지능|챗봇|언어\s*모델|어시스턴트|도우미)/i;

// 답변이 몇 문장인지 대략 센다(종결 부호 기준). 규칙은 1~2문장이고 3문장까지 허용한다.
const MAX_SENTENCES = 3;
const countSentences = (text: string): number =>
  text.split(/[.!?。！？]+/).filter((part) => part.trim().length > 0).length;

// 생성된 답변이 규칙을 지켰는지 본다. 통과하면 null, 어기면 사유를 돌려준다.
// cleanReply를 거친 문자열을 넣어야 한다(세척으로 해결되는 건 여기서 거르지 않기 위함).
export const validateReply = (reply: string): ReplyRejectionReason | null => {
  const text = reply.trim();
  if (text.length === 0) return "empty";

  // 배역 이탈: AI/도우미를 언급했는데 정해진 고정 문구가 아닌 경우.
  // (정체 질문은 위에서 인터셉트되므로, 여기 걸리는 건 LLM이 스스로 정체를 꺼낸 경우다.)
  if (AI_SELF_REFERENCE.test(text) && !text.includes(AI_IDENTITY_PHRASE)) {
    return "identity_drift";
  }

  // 세척 후에도 남은 서식: 마크다운 강조·머리기호, 해설로 보이는 긴 괄호.
  if (/[*_`]{1,}[^*_`]+[*_`]{1,}/.test(text)) return "format_leak";
  if (/^\s*[>#-]\s/m.test(text)) return "format_leak";
  if (/[(（][^)）]{10,}(?:습니다|했어요|봤습니다|입니다)[)）]/.test(text)) return "format_leak";

  if (countSentences(text) > MAX_SENTENCES) return "too_long";

  return null;
};
