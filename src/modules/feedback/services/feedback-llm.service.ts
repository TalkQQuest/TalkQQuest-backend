import { z } from "zod";
import { logger } from "../../../config/logger";
import {
  callUpstageChat,
  generateWithRetry,
  parseJsonResponse,
  UpstageChatMessage,
} from "../../../shared/ai";
import { FEEDBACK_METRIC_KEYS, FeedbackMetricKey } from "../dtos/feedback.constants";

// 대화 기반 피드백(E101) 생성 — POST /feedback.
// 미션 추천(mission/llm.service)과 같은 "JSON 강제 + zod 검증" 패턴을 쓰되,
// 여기서는 실패해도 가짜 점수/분석을 지어내지 않는다(자기성장 앱에서 허위 분석은
// 미션 템플릿 폴백과 달리 사용자에게 해가 될 수 있음) — 실패 시 호출부가 status=failed로
// 남기고 재시도 버튼(POST /feedback/{id}/retry)으로 안내한다.

const MAX_TOKENS = 1200; // 지표 4개 * strengths/improvements/bestSentence라 미션보다 길다.
const TEMPERATURE = 0.5; // 점수/분석이라 미션·대화보다 더 일관되게.
const MAX_TRANSCRIPT_MESSAGES = 40; // 프롬프트 비용 보호용 상한.

export interface FeedbackTranscriptMessage {
  role: "user" | "guide" | "system";
  content: string;
}

export interface FeedbackMissionContext {
  objective?: string;
  successCriteria?: string[];
  feedbackFocus?: string[];
}

// bestSentence/savedPhrase를 문장 그대로 쓰게 했더니 사용자가 하지 않은 말이 올라왔다:
// 미션 설명의 예시 문장("오늘 어떤 음료가 인기 있어요?")이나 상대(AI) 발화가 그대로 잡혔다.
// 베스트 문장은 문장 저장에도 쓰여서 신뢰 문제로 직결되므로, 프롬프트 지시로 막는 대신
// **번호로만 고르게** 해서 사용자 발화 밖의 문장이 나올 수 없도록 구조적으로 차단한다.
// (번호는 프롬프트에 [1], [2] … 로 매긴 사용자 발화 목록의 1-based 인덱스)
const userUtteranceIndexSchema = z.number().int().positive();

const metricSchema = z.object({
  score: z.number().int().min(0).max(100),
  // 프롬프트가 1~3개를 요구한다. 상한을 느슨하게 두면 4~5개를 받아도 검증이 통과해
  // 재시도가 걸리지 않고, 화면이 감당하지 못하는 길이가 그대로 나간다.
  strengths: z.array(z.string().min(1)).min(1).max(3),
  improvements: z.array(z.string().min(1)).min(1).max(3),
  bestSentenceIndex: userUtteranceIndexSchema,
});

// 요약 칩은 문장이 아니라 단어/짧은 키워드여야 한다(예: "자기성장", "첫 만남", "스몰토크").
// 공백을 포함할 수 있으나(첫 만남) 너무 길면 문장으로 본다 → 12자 상한으로 단어 포맷을 강제한다.
const summaryChipSchema = z.array(z.string().min(1).max(12)).length(3);

const feedbackLlmSchema = z.object({
  kindness: metricSchema,
  initiative: metricSchema,
  empathy: metricSchema,
  questionLink: metricSchema,
  missionSummary: z.array(z.string().min(1)).min(1).max(3),
  summaryChips: summaryChipSchema,
  // 대화 전체를 2~3문장으로 요약한 텍스트(칩과 달리 문장형).
  conversationSummary: z.string().min(1).max(500),
  // 대화 카드(목록)용 1~2줄 축약 요약. conversationSummary와 같은 대화 내용을 기반으로 하되
  // 짧은 버전으로 함께 생성한다(#169).
  cardSummary: z.string().min(1).max(100),
  // "주요 내용" — 대화에서 실제 있었던 흐름을 시간 순으로 2~3개(#169).
  conversationHighlights: z.array(z.string().min(1).max(80)).min(2).max(3),
  savedPhraseIndex: userUtteranceIndexSchema,
});

// LLM이 고른 번호를 실제 발화 문자열로 바꾼 뒤의 형태. 호출부는 여전히 문장만 다룬다.
export interface FeedbackLlmMetric {
  score: number;
  strengths: string[];
  improvements: string[];
  bestSentence: string;
}

export type FeedbackLlmMetrics = Record<FeedbackMetricKey, FeedbackLlmMetric>;

export interface FeedbackLlmResult {
  metrics: FeedbackLlmMetrics;
  missionSummary: string[];
  summaryChips: string[];
  conversationSummary: string;
  cardSummary: string;
  conversationHighlights: string[];
  savedPhrase: string;
}

// 프롬프트에 넣을 대화 기록의 표준형.
//
// 대화 기록과 "사용자 발화 목록"은 **같은 목록에 같은 번호**를 매겨야 한다. 예전에는
// 대화 기록이 내용 없는 사용자 발화까지 세고 후보 목록은 그걸 걸러내서, 앞이나 중간에
// 공백 발화가 하나라도 있으면 이후 번호가 통째로 한 칸씩 밀렸다. 모델이 대화 기록 기준으로
// 번호를 고르면 서버는 다른 문장을 bestSentence/savedPhrase로 저장한다 —
// 번호로만 고르게 해서 날조를 막아 놓고, 정작 엉뚱한 발화를 사용자 말로 되돌려주는 셈이다.
//
// 그래서 여기서 한 번 걸러 두 곳이 모두 이 결과만 쓰게 한다.
const normalizeTranscript = (
  transcript: FeedbackTranscriptMessage[]
): FeedbackTranscriptMessage[] =>
  transcript
    .map((m) => (m.role === "user" ? { ...m, content: m.content.trim() } : m))
    .filter((m) => m.role !== "user" || m.content.length > 0)
    // 상한은 걸러낸 뒤에 적용한다. 먼저 자르면 끝쪽에 몰린 공백 발화가 상한을 차지해
    // 그 앞의 유효한 발화가 통째로 밀려나고, 후보 목록이 비어 피드백 생성이 실패한다.
    .slice(-MAX_TRANSCRIPT_MESSAGES);

// 번호를 매길 사용자 발화만 추려낸다(순서 = 번호).
const collectUserUtterances = (transcript: FeedbackTranscriptMessage[]): string[] =>
  normalizeTranscript(transcript)
    .filter((m) => m.role === "user")
    .map((m) => m.content);

const SYSTEM_PROMPT = `당신은 사용자의 실제 대화 연습을 분석하는 코치입니다.
아래 대화 기록을 바탕으로 사용자(user)의 발화만 평가합니다. guide/system 메시지는 상대방 또는 안내이므로 평가 대상이 아닙니다.

평가 우선순위:
1. 먼저 미션 제목·설명과 제공된 미션 상위 목적(objective), 미션 수행 기준(successCriteria), 미션별 피드백 관찰 포인트(feedbackFocus)를 확인합니다.
2. 실제 대화 기록을 보고 해당 미션을 자연스럽게 수행하는 방식의 범위를 판단합니다.
3. 공통 지표는 그 자연스러운 수행 범위 안에서 평가합니다.
4. 공통 지표를 보여주기 위해 미션 목적에 없거나 대화를 불필요하게 늘리는 행동을 새로 요구하지 않습니다.
5. 공통 지표의 일반적인 행동 예시와 미션 목적이 충돌하면 미션 목적과 실제 상황의 자연스러움을 우선합니다.
Playbook 평가 문맥이 제공되지 않은 경우에는 미션 제목·설명과 실제 대화 기록을 같은 우선순위로 사용합니다.

다음 4개 지표를 각각 0~100점으로 채점합니다:
- kindness (친절한 태도): 존중·배려가 담긴 표현을 썼는가
- initiative (대화 주도): 상황에 필요한 말을 먼저 시작하거나 필요한 정보와 응답을 주고받으며 목적을 향해 대화를 진행했는가. 주도성은 반드시 대화를 길게 확장하는 것을 뜻하지 않습니다. 짧은 미션에서도 먼저 인사·주문·요청하고 필요한 응답을 제공했다면 주도성을 보인 것으로 평가할 수 있습니다.
- empathy (공감·사회적 배려): 상대의 말과 상황을 이해하고 그에 맞는 배려 있는 반응을 했는가. 감정적인 공감 문장이 항상 필요한 것은 아닙니다. 단순 서비스 상황에서는 공손한 응답, 상대 요청에 맞는 정보 제공, 감사 표현도 충분한 사회적 배려가 될 수 있습니다.
- questionLink (질문 연결성): 대화 맥락상 후속 질문이 자연스럽거나 필요한 경우 상대의 답변과 연결되는 질문을 했는가. 모든 대화에서 후속 질문을 요구하는 지표가 아닙니다. 질문 없이 자연스럽게 완료되는 주문·인사·요청 미션에서는 질문하지 않은 사실 자체를 감점 근거로 사용하지 않습니다. 후속 질문 기회가 없었다면 상대의 질문이나 안내에 맥락에 맞게 반응하며 대화 흐름을 자연스럽게 이어갔는지도 함께 봅니다.

채점 기준 (#185 — 근거 없이 후하게 채점하지 않도록, 점수를 정하기 전에 먼저 아래 등급 중 하나를 판정하고 그 등급의 범위 안에서만 점수를 고릅니다):
- 0~49점: 다음 중 하나에 해당합니다 — (a) 무례하거나 부적절한 발화가 있음, (b) 실질적인 의사 전달이 없는 발화(예: "1", "ㅇㅇ", 의미 없는 자모음, 같은 말을 그냥 반복하는 등 — 짧다는 이유가 아니라 **어떤 상황에 갖다 놔도 뜻이 통하지 않는다는 게 이유**), (c) 미션 맥락과 명백히 무관한 딴 얘기. 이런 발화가 대화 내내 반복됐다면 40점 이하로, 일부만 섞였다면 그 비중만큼 45~49점 선까지 올라갈 수 있습니다. **이 조건에 해당하면 아무리 응답 횟수가 많아도(즉 "참여는 했다"는 이유로) 50점 이상을 주지 않습니다.**
- 50~59점: (a)~(c)에 해당하지 않고, 실제 상황에 맞는 최소한의 의사 표현(예: "네", "아메리카노요", "감사합니다"처럼 짧아도 그 상황에서 뜻이 분명한 응답)은 했지만, 그 이상의 노력(먼저 배려를 건네거나, 먼저 대화를 이끌거나, 상대 상황을 헤아리는 등)은 보이지 않는 수준입니다.
- 60~69점: 대화가 자연스럽게 흘러가고 상황에 맞게 응답합니다. (kindness: 예의를 지킴 / initiative: 필요한 응답을 놓치지 않고 함 / empathy: 상대 말에 맞게 반응함 / questionLink: 문맥에 맞는 응답을 함)
- 70~89점: 60점대 수준을 넘어, 실제 대화에서 확인되는 적극적인 행동의 구체적 근거가 있습니다 — 그 근거를 strengths에 실제 발화로 인용할 수 있어야 합니다. (kindness: 먼저 배려의 표현을 건넴 / initiative: 먼저 말을 꺼내 대화를 원하는 방향으로 이끎 / empathy: 상대 상황을 미리 짐작해 반응함 / questionLink: 상대 답변을 바탕으로 대화를 한 단계 더 발전시킴)
- 90~100점: 70~89점의 근거 중에서도, 그 상황에서 유독 인상적이고 구체적인 발화가 있을 때만 줍니다. "네", "감사해요", "괜찮아요" 같이 흔하고 평범한 문장은 아무리 여러 번 나와도 90점 이상의 근거가 될 수 없습니다. 다른 사용자였어도 흔히 했을 법한 말이 아니라, 그 상황·그 사람만의 구체적이고 세심한 표현일 때만 90점 이상을 줍니다.
- 특별한 노력이나 강점의 구체적 근거를 찾지 못했다면, 애매하게 60~70점대 사이 숫자를 고르지 말고 위 등급 정의에 따라 명확히 판정하세요. 근거가 없다는 이유로 임의로 70점 이상을 주지 않습니다.

규칙:
- 각 지표마다 strengths(잘한 점)와 improvements(개선 제안)를 1~3개씩 씁니다.
- 각 지표를 평가하기 전에 미션 목적과 실제 대화 흐름에서 그 역량을 보여줄 합리적인 기회가 있었는지 먼저 판단합니다. 특정 행동을 하지 않았다는 사실만으로 부족하다고 판단하지 말고, 그 행동이 실제로 필요하거나 자연스러운 상황이었는지 확인합니다.
- 합리적인 기회가 있었다면 실제 수행을 평가합니다. 기회가 있었는데 놓쳤거나 관련 행동이 부자연스러웠다는 대화 근거가 있을 때만 그 부족함을 점수와 improvements에 반영합니다.
- 합리적인 기회가 없었다면 기회 부족 자체를 낮은 수행의 근거로 삼지 않습니다. 특히 질문이 필요하지 않거나 추가 질문이 대화를 불필요하게 늘리는 미션에서는 질문하지 않았다는 이유만으로 questionLink를 감점하거나 불필요한 질문을 요구하지 않습니다. 단, successCriteria에 질문이 없더라도 실제 대화에서 자연스러운 후속 질문 기회가 있었다면 questionLink를 기존 정의대로 평가합니다.
- strengths는 실제 사용자 발화에서 확인되는 긍정 행동을 최소 1개 구체적으로 씁니다. 작은 행동도 인정하되, 하지 않은 행동을 했다고 칭찬하지 않습니다. 해당 지표의 관찰 기회가 부족했다면 대화를 미션에 맞게 자연스럽게 수행한 점을 인정하되 그 지표를 잘 수행했다고 과장하지 않습니다.
- improvements는 현재 미션에서 실제로 확인된 부족함이 있으면 구체적인 개선점을 씁니다. 특별한 부족함이나 관찰 기회가 없다면 현재 수행의 결함을 지어내지 말고, "다음에 실제로 해당 상황이 생긴다면"처럼 적용 조건을 밝힌 동기부여형 확장 팁을 최소 1개 씁니다. 확장 팁을 현재 미션에서 했어야 할 행동처럼 표현하거나, 팁을 만들기 위해 현재 미션과 무관한 행동을 새로 제안하지 않습니다.
- 어떤 행동이 현재 미션의 objective, successCriteria, feedbackFocus에 필요하지 않고 실제 대화에서도 그 행동의 필요성이 발생하지 않았다면, 그 행동을 "하면 더 높은 점수를 받을 수 있다"는 의미의 improvements로 제안하지 않습니다.
- 관찰 기회가 없었던 지표의 improvements는 현재 미션을 더 길게 확장하는 행동이 아니라, 같은 역량이 실제로 필요한 다른 상황에서 사용할 수 있는 조건부 팁으로 작성합니다. 현재 미션을 다시 수행하거나 불필요하게 이어가라는 의미가 되어서는 안 됩니다.
- 사용자가 미션을 자연스럽게 완료했다면 다음을 improvements로 만들지 않습니다: 대화를 더 길게 이어가라는 요구, 미션 수행에 필요하지 않은 추가 요청, 추천 메뉴나 결제 방법처럼 불필요한 후속 질문, 단순 주문 상황에 어울리지 않는 감정적 공감 문장, 이미 완료된 목적을 다시 확인하거나 반복하게 하는 발화.
- bestSentenceIndex: 그 지표를 가장 잘 보여주는 발화를 "사용자 발화 목록"에서 골라 그 **번호만** 적습니다. 문장을 직접 쓰지 말고, 목록에 있는 번호 중 하나를 정수로만 적습니다. 목록에 없는 문장(미션 설명의 예시 문장, 상대 발화 등)은 절대 고르면 안 됩니다.
- 해당 지표의 관찰 기회가 부족한 경우 bestSentenceIndex는 가장 관련 있거나 대화를 자연스럽게 수행한 사용자 발화를 고릅니다. 그 문장이 해당 지표를 잘 수행했다는 식으로 strengths를 과장하지 않습니다.
- missionSummary: 미션 완료 화면에 보여줄 짧은 요약 태그를 1~3개 생성합니다 (예: "장소 경험을 공유했어요").
- summaryChips: 이 대화 전체를 대표하는 키워드 칩을 정확히 3개 생성합니다. 반드시 문장이 아니라 단어/짧은 명사구여야 하며(예: "자기성장", "첫 만남", "스몰토크"), 각 칩은 최대 12자, 마침표나 서술형 어미를 쓰지 않습니다.
- conversationSummary: 이 대화가 어떤 내용이었는지 2~3문장으로 요약합니다. 나중에 대화 기록을 다시 볼 때 한눈에 파악할 수 있도록 무엇에 대해 이야기했는지 중심으로 쓰고, 평가나 점수는 넣지 않습니다.
- cardSummary: conversationSummary와 같은 대화 내용을 바탕으로, 목록 카드에 보여줄 1~2줄(50자 내외)의 축약 버전을 씁니다. 새로운 내용을 넣지 말고 conversationSummary를 짧게 줄인 버전이어야 합니다.
- conversationHighlights: 이 대화에서 실제로 있었던 흐름을 시간 순서대로 2~3개의 짧은 문장으로 씁니다 (예: "먼저 인사를 건네며 대화를 시작했어요", "상대의 질문에 답하며 대화를 이어갔어요"). missionSummary(평가 태그)나 conversationSummary(전체 요약)와 달리, 대화 중 실제로 일어난 행동을 순서대로 나열하는 것입니다.
- savedPhraseIndex: 사용자가 나중에 다시 쓰기 좋은 발화를 "사용자 발화 목록"에서 골라 그 **번호만** 적습니다. bestSentenceIndex와 같은 규칙입니다.
- 근거 없이 과장하지 말고, 실제 대화 내용에 기반해 구체적으로 씁니다.
- 반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트는 절대 포함하지 마세요.
{
  "kindness": { "score": 0-100 정수, "strengths": ["string"], "improvements": ["string"], "bestSentenceIndex": 정수 },
  "initiative": { ... 위와 동일 구조 ... },
  "empathy": { ... 위와 동일 구조 ... },
  "questionLink": { ... 위와 동일 구조 ... },
  "missionSummary": ["string"],
  "summaryChips": ["단어", "단어", "단어"],
  "conversationSummary": "string",
  "cardSummary": "string",
  "conversationHighlights": ["string", "string"],
  "savedPhraseIndex": 정수
}`;

// 프롬프트는 순수 함수로 만들어 단독 검증이 가능하게 한다.
export const buildFeedbackMessages = (
  transcript: FeedbackTranscriptMessage[],
  missionTitle: string,
  missionDescription: string | null,
  missionContext?: FeedbackMissionContext
): UpstageChatMessage[] => {
  // 후보 목록과 같은 정규화를 거친 기록을 쓴다. 번호가 어긋나면 안 되기 때문이다.
  const trimmed = normalizeTranscript(transcript);

  // 대화 기록에도 사용자 발화에 번호를 붙여, 아래 "사용자 발화 목록"과 같은 번호로 대조하게 한다.
  let userIndex = 0;
  const transcriptText = trimmed
    .map((m) => {
      if (m.role !== "user") return `상대: ${m.content}`;
      userIndex += 1;
      return `사용자[${userIndex}]: ${m.content}`;
    })
    .join("\n");

  // 고를 수 있는 후보를 따로 한 번 더 보여준다. 목록 밖 문장을 지어내는 것을 줄이기 위함이고,
  // 설령 지어내더라도 번호만 받으므로 결과에는 반영되지 않는다.
  const utteranceList = collectUserUtterances(transcript)
    .map((content, i) => `[${i + 1}] ${content}`)
    .join("\n");

  const contextLines = [`미션: ${missionTitle}`];
  if (missionDescription) {
    // 미션 설명의 예시 문장이 사용자 발화로 둔갑한 사례가 있어 경계를 명시한다.
    contextLines.push(`미션 설명(참고용 — 여기 있는 예시 문장은 사용자가 한 말이 아닙니다): ${missionDescription}`);
  }

  const evaluationContextLines: string[] = [];
  if (missionContext?.objective) {
    evaluationContextLines.push(
      "미션 상위 목적(평가 항목이 아니라 수행 기준을 이해하기 위한 참고 문맥):",
      `- ${missionContext.objective}`
    );
  }
  if (missionContext?.successCriteria?.length) {
    evaluationContextLines.push(
      "미션 수행 기준:",
      ...missionContext.successCriteria.map((criterion, index) => `${index + 1}. ${criterion}`)
    );
  }
  if (missionContext?.feedbackFocus?.length) {
    evaluationContextLines.push(
      "미션별 피드백 관찰 포인트:",
      ...missionContext.feedbackFocus.map((focus, index) => `${index + 1}. ${focus}`)
    );
  }

  if (evaluationContextLines.length > 0) {
    evaluationContextLines.push(
      "평가 적용 규칙:",
      "- 미션 수행 기준은 실제 대화 기록과 비교하고, 기록에서 확인할 수 없는 행동을 수행했다고 추정하지 마세요.",
      "- 미션 수행 기준의 달성 여부는 주로 missionSummary에 반영하세요.",
      "- 미션별 피드백 관찰 포인트는 실제 사용자 발화에서 관찰 가능하고 해당 공통 지표와 관련 있을 때만 strengths 또는 improvements에 반영하세요.",
      "- kindness, initiative, empathy, questionLink의 기존 정의를 유지하고, 미션 성공 또는 실패 자체를 이유로 네 점수를 일괄적으로 올리거나 내리지 마세요.",
      "- strengths와 improvements는 미션 상위 목적, 미션 수행 기준, 미션별 피드백 관찰 포인트와 모순되면 안 됩니다.",
      "- 사용자가 미션을 이미 자연스럽게 완료했다면 공통 지표를 보여주기 위한 불필요한 행동을 추가로 요구하지 마세요."
    );
  }

  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        contextLines.join("\n"),
        ...(evaluationContextLines.length > 0 ? ["", evaluationContextLines.join("\n")] : []),
        "",
        "대화 기록:",
        transcriptText,
        "",
        "사용자 발화 목록 (bestSentenceIndex/savedPhraseIndex는 반드시 이 번호 중에서 고릅니다):",
        utteranceList,
        "",
        "위 대화를 분석해 JSON으로 피드백을 생성해주세요.",
      ].join("\n"),
    },
  ];
};

const parseFeedbackLlm = (
  rawContent: string,
  userUtterances: string[]
): FeedbackLlmResult | null => {
  const data = parseJsonResponse(rawContent, feedbackLlmSchema, "피드백");
  if (!data) return null;

  // 번호를 실제 발화로 되돌린다. 범위를 벗어나면 사용자가 하지 않은 말을 지어낸 것이므로
  // 응답 전체를 버린다(재시도 → 그래도 실패하면 status=failed). 이 앱은 실패를 감수하더라도
  // 허위 피드백을 만들지 않는 쪽을 택한다.
  const resolve = (index: number): string | null => userUtterances[index - 1] ?? null;

  const metrics = {} as FeedbackLlmMetrics;
  for (const key of FEEDBACK_METRIC_KEYS) {
    const { bestSentenceIndex, ...rest } = data[key];
    const bestSentence = resolve(bestSentenceIndex);
    if (!bestSentence) {
      logger.warn(
        { metric: key, bestSentenceIndex, utteranceCount: userUtterances.length },
        "피드백 LLM이 사용자 발화 범위를 벗어난 번호를 골랐습니다"
      );
      return null;
    }
    metrics[key] = { ...rest, bestSentence };
  }

  const savedPhrase = resolve(data.savedPhraseIndex);
  if (!savedPhrase) {
    logger.warn(
      { savedPhraseIndex: data.savedPhraseIndex, utteranceCount: userUtterances.length },
      "피드백 LLM이 savedPhrase로 사용자 발화 범위를 벗어난 번호를 골랐습니다"
    );
    return null;
  }

  return {
    metrics,
    missionSummary: data.missionSummary,
    summaryChips: data.summaryChips,
    conversationSummary: data.conversationSummary,
    cardSummary: data.cardSummary,
    conversationHighlights: data.conversationHighlights,
    savedPhrase,
  };
};

const callOnce = async (
  messages: UpstageChatMessage[],
  userUtterances: string[]
): Promise<FeedbackLlmResult | null> => {
  const result = await callUpstageChat(messages, {
    temperature: TEMPERATURE,
    maxTokens: MAX_TOKENS,
    jsonMode: true,
  });
  if (!result.ok) {
    logger.warn({ reason: result.reason }, "피드백 LLM 호출 실패");
    return null;
  }
  return parseFeedbackLlm(result.content, userUtterances);
};

// 진입점. 1회 재시도 후에도 실패하면 null — 호출부(feedback.service)가 status=failed로 남긴다.
// 미션 추천과 달리 실패 시 가짜 분석으로 대체하지 않는다(허위 피드백 방지).
export const generateFeedbackWithLlm = (
  transcript: FeedbackTranscriptMessage[],
  missionTitle: string,
  missionDescription: string | null,
  missionContext?: FeedbackMissionContext
): Promise<FeedbackLlmResult | null> => {
  const messages = buildFeedbackMessages(
    transcript,
    missionTitle,
    missionDescription,
    missionContext
  );
  const userUtterances = collectUserUtterances(transcript);

  return generateWithRetry(() => callOnce(messages, userUtterances), { label: "피드백" });
};

// 서비스 계층에서 지표 순서를 고정해 순회할 때 쓴다.
export { FEEDBACK_METRIC_KEYS };