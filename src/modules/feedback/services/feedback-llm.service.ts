import { z } from "zod";
import { logger } from "../../../config/logger";
import { callUpstageChat, UpstageChatMessage } from "../../../shared/llm/upstage";
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

// bestSentence/savedPhrase를 문장 그대로 쓰게 했더니 사용자가 하지 않은 말이 올라왔다:
// 미션 설명의 예시 문장("오늘 어떤 음료가 인기 있어요?")이나 상대(AI) 발화가 그대로 잡혔다.
// 베스트 문장은 문장 저장에도 쓰여서 신뢰 문제로 직결되므로, 프롬프트 지시로 막는 대신
// **번호로만 고르게** 해서 사용자 발화 밖의 문장이 나올 수 없도록 구조적으로 차단한다.
// (번호는 프롬프트에 [1], [2] … 로 매긴 사용자 발화 목록의 1-based 인덱스)
const userUtteranceIndexSchema = z.number().int().positive();

const metricSchema = z.object({
  score: z.number().int().min(0).max(100),
  strengths: z.array(z.string().min(1)).min(1).max(5),
  improvements: z.array(z.string().min(1)).min(1).max(5),
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
  savedPhrase: string;
}

// 프롬프트에 번호를 매겨 넣을 사용자 발화만 추려낸다(순서 = 번호).
// 프롬프트와 검증이 같은 목록을 봐야 하므로 트리밍 이후 기준으로 뽑는다.
const collectUserUtterances = (transcript: FeedbackTranscriptMessage[]): string[] =>
  transcript
    .slice(-MAX_TRANSCRIPT_MESSAGES)
    .filter((m) => m.role === "user")
    .map((m) => m.content.trim())
    .filter((content) => content.length > 0);

const SYSTEM_PROMPT = `당신은 사용자의 실제 대화 연습을 분석하는 코치입니다.
아래 대화 기록을 바탕으로 사용자(user)의 발화만 평가합니다. guide/system 메시지는 상대방 또는 안내이므로 평가 대상이 아닙니다.

다음 4개 지표를 각각 0~100점으로 채점합니다:
- kindness (친절한 태도): 존중·배려가 담긴 표현을 썼는가
- initiative (대화 주도): 먼저 화제를 꺼내거나 대화를 이끌었는가
- empathy (공감 능력): 상대의 말에 공감을 표현했는가
- questionLink (질문 연결성): 상대의 답변에 이어지는 질문을 했는가

규칙:
- 각 지표마다 strengths(잘한 점)와 improvements(개선 제안)를 1~3개씩 씁니다.
- bestSentenceIndex: 그 지표를 가장 잘 보여주는 발화를 "사용자 발화 목록"에서 골라 그 **번호만** 적습니다. 문장을 직접 쓰지 말고, 목록에 있는 번호 중 하나를 정수로만 적습니다. 목록에 없는 문장(미션 설명의 예시 문장, 상대 발화 등)은 절대 고르면 안 됩니다.
- missionSummary: 미션 완료 화면에 보여줄 짧은 요약 태그를 1~3개 생성합니다 (예: "장소 경험을 공유했어요").
- summaryChips: 이 대화 전체를 대표하는 키워드 칩을 정확히 3개 생성합니다. 반드시 문장이 아니라 단어/짧은 명사구여야 하며(예: "자기성장", "첫 만남", "스몰토크"), 각 칩은 최대 12자, 마침표나 서술형 어미를 쓰지 않습니다.
- conversationSummary: 이 대화가 어떤 내용이었는지 2~3문장으로 요약합니다. 나중에 대화 기록을 다시 볼 때 한눈에 파악할 수 있도록 무엇에 대해 이야기했는지 중심으로 쓰고, 평가나 점수는 넣지 않습니다.
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
  "savedPhraseIndex": 정수
}`;

// 프롬프트는 순수 함수로 만들어 단독 검증이 가능하게 한다.
export const buildFeedbackMessages = (
  transcript: FeedbackTranscriptMessage[],
  missionTitle: string,
  missionDescription: string | null
): UpstageChatMessage[] => {
  const trimmed = transcript.slice(-MAX_TRANSCRIPT_MESSAGES);

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

  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        contextLines.join("\n"),
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

const cleanJson = (raw: string): string =>
  raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();

const parseFeedbackLlm = (
  rawContent: string,
  userUtterances: string[]
): FeedbackLlmResult | null => {
  let json: unknown;
  try {
    json = JSON.parse(cleanJson(rawContent));
  } catch {
    logger.warn("피드백 LLM 응답 JSON 파싱 실패");
    return null;
  }

  const parsed = feedbackLlmSchema.safeParse(json);
  if (!parsed.success) {
    logger.warn({ issues: parsed.error.issues }, "피드백 LLM 응답 스키마 검증 실패");
    return null;
  }

  const data = parsed.data;

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
export const generateFeedbackWithLlm = async (
  transcript: FeedbackTranscriptMessage[],
  missionTitle: string,
  missionDescription: string | null
): Promise<FeedbackLlmResult | null> => {
  const messages = buildFeedbackMessages(transcript, missionTitle, missionDescription);
  const userUtterances = collectUserUtterances(transcript);

  const first = await callOnce(messages, userUtterances);
  if (first) return first;

  logger.warn("피드백 LLM 1차 실패 — 재시도");
  const retry = await callOnce(messages, userUtterances);
  if (retry) return retry;

  logger.warn("피드백 LLM 재시도까지 실패");
  return null;
};

// 서비스 계층에서 지표 순서를 고정해 순회할 때 쓴다.
export { FEEDBACK_METRIC_KEYS };
