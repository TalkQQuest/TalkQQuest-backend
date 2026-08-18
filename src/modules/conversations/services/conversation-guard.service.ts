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
//
// 오탐이 나면 역할극 도중 고정 정체 응답이 끼어들고 그게 대화 이력에 저장되므로,
// 대상이 분명한 발화만 잡는다. 판정 기준은 "지금 말 상대에게 묻고 있는가"다.
//
// 2인칭은 어절 경계를 요구한다. 경계 없이 "니"를 찾으면 "그러니까", "재미있으니" 같은
// 어미에 걸려 평범한 발화가 정체 질문이 된다. 장소를 가리키는 "여기"도 뺐다 —
// "여기 뭐예요?"는 상대의 정체를 묻는 말이 아니다.
const SECOND_PERSON = /(?:^|[\s,.!?"'“”])(너|넌|네가|니가|당신|그쪽|본인)(?=$|[\s,.!?은는이가랑도])/;
// "사람이야"류는 여기서 빼고 아래 HUMAN_PROBE로 따로 본다. 여기 두면 제3자를 가리키는
// 절("그 사람이야?")과 2인칭이 한 문장에 같이 있을 때 함께 걸려 오탐이 난다.
const IDENTITY_PROBE =
  /(정체|누구(야|세요|시죠|신가요)|뭐야|뭐예요|뭐니|인간이(야|에요)|ai(야|에요|예요|입니까|인가요)?|에이아이|인공지능|챗봇|봇이(야|에요)|로봇|기계)/i;

// 2인칭 없이도 명백히 정체를 묻는 표현. AI·챗봇을 직접 거론하므로 대상이 분명하다.
// "진짜 사람"은 그 자체로는 정체를 묻는 말이 아니라("여긴 진짜 사람 많아요.") 확인을 구하는
// 종결형이 붙었을 때만 잡는다.
const DIRECT_IDENTITY_PROBE =
  /(ai야|ai에요|ai예요|ai인가요|ai입니까|챗봇이야|챗봇이에요|챗봇인가요|인공지능이야|인공지능인가요|진짜\s*사람\s*(?:이야|이에요|이예요|인가요|입니까|맞아|맞아요|맞나요|맞죠|맞습니까))/i;

// "사람이야?"는 대상이 분명하지 않다. 아래처럼 지시어가 붙으면 제3자를 가리키는
// 역할극 발화("그 사람이야? 네가 말한 선배가?")이므로 정체 질문에서 제외한다.
const HUMAN_PROBE = /사람이(야|에요|예요|세요)|사람인가요/;
// "사람이야"와 "사람인가요" 두 형태를 모두 덮어야 한다(앞 음절이 '이'/'인'으로 갈린다).
const THIRD_PARTY_MODIFIER = /(그|이|저|어떤|무슨|다른|같은)\s*사람(이|인)/;

export const matchesIdentityQuestion = (message: string): boolean => {
  const text = message.trim().toLowerCase();
  if (text.length === 0) return false;
  if (DIRECT_IDENTITY_PROBE.test(text)) return true;
  if (HUMAN_PROBE.test(text) && !THIRD_PARTY_MODIFIER.test(text)) return true;
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

// 닫는 따옴표 뒤에 남아도 되는 꼬리: 공백·문장부호·이모지뿐이다.
// 글자가 남아 있으면 그건 답변을 감싼 따옴표가 아니라 문장 안의 인용이다.
const isWrapperTail = (tail: string): boolean => /^[\s\p{P}\p{S}]*$/u.test(tail);

const containsQuote = (text: string): boolean =>
  [...text].some((char) => QUOTE_CHARS.includes(char));

// 답변 전체를 감싼 따옴표만 제거하고, 뒤쪽 꼬리(이모지·공백 등)는 남긴다.
const stripWrappingQuotes = (text: string): string => {
  const opensWithQuote = QUOTE_CHARS.includes(text[0] ?? "");

  // 끝에서부터 따옴표가 아닌 꼬리(이모지·공백·문장부호)를 건너뛰어 닫는 따옴표 위치를 찾는다.
  let end = text.length - 1;
  while (end >= 0 && !QUOTE_CHARS.includes(text[end])) end -= 1;

  // 마지막 따옴표 뒤에 글자가 이어지면 감싼 게 아니다.
  // 예: `"고마워"라고 먼저 말해봤어요.` — 여기서 떼면 인용부호가 사라져 뜻이 달라진다.
  // 이 경우 여는 따옴표도 건드리지 않는다(짝이 맞는 정상 인용이므로).
  const wrapsToEnd = end > 0 && isWrapperTail(text.slice(end + 1));

  if (opensWithQuote && wrapsToEnd) {
    // 안쪽에 또 다른 따옴표가 있으면 감싼 것으로 보지 않는다.
    // 예: `"그는 "고마워"라고 말했어요."` — 바깥을 떼면 짝이 어긋나 남은 인용부호가 노출된다.
    if (containsQuote(text.slice(1, end))) return text;
    // 정상적으로 감싼 경우: 양쪽 따옴표만 떼고 꼬리는 살린다.
    return (text.slice(1, end) + text.slice(end + 1)).trim();
  }
  if (!opensWithQuote && wrapsToEnd && !containsQuote(text.slice(0, end))) {
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

// 답변이 몇 문장인지 대략 센다(종결 부호 기준). 규칙은 1~2문장이고 4문장까지 허용한다.
//
// #252 — "어, 펜?", "아 이게?" 같은 맨 앞의 짧은 감탄사·되물음이 종결 부호(?) 하나로
// 끝난다는 이유만으로 "문장 하나"로 세져서, 실제로는 자연스러운 1~2문장짜리 답("어, 펜?
// 이건 내가 좋아하는 샤프야. 근데 너 취미는 뭐야?")이 4문장으로 계산돼 too_long으로
// 거부되는 경우가 실측 확인됐다. **맨 앞** 조각이 아주 짧을 때만 다음 조각에 붙여 하나로
// 센다 — 뒤이은 조각들까지 전부 이렇게 봐주면 "네. 그렇군요. 저도요. 정말 좋네요. 또
// 얘기해요."처럼 짧은 문장을 속사포로 늘어놓는 진짜 too_long 사례까지 통과시켜 버린다.
//
// 상한을 3 → 4로도 살짝 올렸다. 여러 미션·설정으로 폭넓게 실측한 결과(#252), 특히
// 친밀도가 아주 높고 격식이 낮은 반말 배역은 감탄사를 걸러낸 뒤에도 자연스럽게 4문장
// (반응+정보+되묻는 질문 2개 등)이 나오는 경우가 잦아, 정상적인 답변까지 재시도만
// 반복하다 무관한 정적 폴백으로 떨어지는 사례가 실측에서 확인됐다.
const MAX_SENTENCES = 4;
const MIN_STANDALONE_SENTENCE_LENGTH = 5;
// 맨 앞 조각이 "감탄사·되물음"인지 판단하는 기준. 길이만 보면 "네.", "그래요." 같은
// 평범한 짧은 평서문까지 감탄사로 오인해 병합해버려, 짧은 문장을 여러 개 늘어놓은
// 진짜 too_long 사례가 병합 한 번으로 상한(4)을 피해가는 경계 케이스가 생긴다(#254 리뷰 지적).
// 되물음(끝이 물음표)이거나, 흔한 감탄사로 시작할 때만 병합 대상으로 좁힌다.
const INTERJECTION_START = /^(어|아|음|오|엥|헐|와|아이고|아하|허|흠|참|자|저기|그니까|근데)\b/;
const countSentences = (text: string): number => {
  // 종결 부호를 유지한 채로 나눠야 맨 앞 조각이 되물음(?)이었는지 알 수 있다.
  const parts = (text.match(/[^.!?。！？]+[.!?。！？]*/g) ?? [])
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length === 0) return 0;

  const first = parts[0];
  const isRhetoricalQuestion = /[?？]\s*$/.test(first);
  const strippedFirst = first.replace(/[.!?。！？,、\s]/g, "");
  const isShortInterjection =
    strippedFirst.length <= MIN_STANDALONE_SENTENCE_LENGTH &&
    (isRhetoricalQuestion || INTERJECTION_START.test(first));

  return isShortInterjection ? Math.max(1, parts.length - 1) : parts.length;
};

// 생성된 답변이 규칙을 지켰는지 본다. 통과하면 null, 어기면 사유를 돌려준다.
// cleanReply를 거친 문자열을 넣어야 한다(세척으로 해결되는 건 여기서 거르지 않기 위함).
export const validateReply = (reply: string): ReplyRejectionReason | null => {
  const text = reply.trim();
  if (text.length === 0) return "empty";

  // 배역 이탈: LLM이 스스로 AI/도우미 정체를 꺼낸 경우.
  // 정체 질문은 서버가 buildIdentityResponse로 직접 답하고 이 검증을 타지 않는다.
  // 따라서 여기 도달한 정체 언급은 전부 배역 이탈이다 — 고정 문구 포함 여부로 봐주면
  // 문구 뒤에 임의의 기능 설명을 덧붙인 답변이 그대로 통과한다.
  if (AI_SELF_REFERENCE.test(text)) {
    return "identity_drift";
  }

  // 세척 후에도 남은 서식: 마크다운 강조·머리기호, 해설로 보이는 긴 괄호.
  if (/[*_`]{1,}[^*_`]+[*_`]{1,}/.test(text)) return "format_leak";
  if (/^\s*[>#-]\s/m.test(text)) return "format_leak";
  if (/[(（][^)）]{10,}(?:습니다|했어요|봤습니다|입니다)[)）]/.test(text)) return "format_leak";

  // 번호·불릿 목록. 위 머리기호 검사는 `- `와 `> `만 잡아 "1. 안녕하세요."가 통과했다.
  if (/^\s*\d+[.)]\s/m.test(text)) return "format_leak";
  if (/^\s*[•·▪]\s/m.test(text)) return "format_leak";

  // 답변은 말풍선 하나에 그대로 들어가므로 여러 줄이면 안 된다.
  // cleanReply가 줄바꿈을 합치지만, 세척을 건너뛴 문자열이 들어와도 걸러지도록 여기서도 본다.
  if (/[\r\n]/.test(text)) return "format_leak";

  // 프롬프트 형식이 그대로 샌 경우(JSON 객체·배열).
  if (/^\s*[[{][\s\S]*[\]}]\s*$/.test(text)) return "format_leak";

  if (countSentences(text) > MAX_SENTENCES) return "too_long";

  return null;
};
