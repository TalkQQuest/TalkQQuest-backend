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

const metricSchema = z.object({
  score: z.number().int().min(0).max(100),
  strengths: z.array(z.string().min(1)).min(1).max(5),
  improvements: z.array(z.string().min(1)).min(1).max(5),
  bestSentence: z.string().min(1),
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
  savedPhrase: z.string().min(1),
});

export type FeedbackLlmMetrics = Record<FeedbackMetricKey, z.infer<typeof metricSchema>>;

export interface FeedbackLlmResult {
  metrics: FeedbackLlmMetrics;
  missionSummary: string[];
  summaryChips: string[];
  savedPhrase: string;
}

const SYSTEM_PROMPT = `당신은 사용자의 실제 대화 연습을 분석하는 코치입니다.
아래 대화 기록을 바탕으로 사용자(user)의 발화만 평가합니다. guide/system 메시지는 상대방 또는 안내이므로 평가 대상이 아닙니다.

다음 4개 지표를 각각 0~100점으로 채점합니다:
- kindness (친절한 태도): 존중·배려가 담긴 표현을 썼는가
- initiative (대화 주도): 먼저 화제를 꺼내거나 대화를 이끌었는가
- empathy (공감 능력): 상대의 말에 공감을 표현했는가
- questionLink (질문 연결성): 상대의 답변에 이어지는 질문을 했는가

규칙:
- 각 지표마다 strengths(잘한 점)와 improvements(개선 제안)를 1~3개씩, 그리고 그 지표를 가장 잘 보여주는 사용자 발화 원문 하나를 bestSentence로 뽑습니다.
- missionSummary: 미션 완료 화면에 보여줄 짧은 요약 태그를 1~3개 생성합니다 (예: "장소 경험을 공유했어요").
- summaryChips: 이 대화 전체를 대표하는 키워드 칩을 정확히 3개 생성합니다. 반드시 문장이 아니라 단어/짧은 명사구여야 하며(예: "자기성장", "첫 만남", "스몰토크"), 각 칩은 최대 12자, 마침표나 서술형 어미를 쓰지 않습니다.
- savedPhrase: 사용자가 나중에 다시 쓰기 좋은, 사용자 자신의 발화 중 하나를 그대로 인용합니다.
- 근거 없이 과장하지 말고, 실제 대화 내용에 기반해 구체적으로 씁니다.
- 반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트는 절대 포함하지 마세요.
{
  "kindness": { "score": 0-100 정수, "strengths": ["string"], "improvements": ["string"], "bestSentence": "string" },
  "initiative": { ... 위와 동일 구조 ... },
  "empathy": { ... 위와 동일 구조 ... },
  "questionLink": { ... 위와 동일 구조 ... },
  "missionSummary": ["string"],
  "summaryChips": ["단어", "단어", "단어"],
  "savedPhrase": "string"
}`;

// 프롬프트는 순수 함수로 만들어 단독 검증이 가능하게 한다.
export const buildFeedbackMessages = (
  transcript: FeedbackTranscriptMessage[],
  missionTitle: string,
  missionDescription: string | null
): UpstageChatMessage[] => {
  const trimmed = transcript.slice(-MAX_TRANSCRIPT_MESSAGES);
  const transcriptText = trimmed
    .map((m) => `${m.role === "user" ? "사용자" : "상대"}: ${m.content}`)
    .join("\n");

  const contextLines = [`미션: ${missionTitle}`];
  if (missionDescription) {
    contextLines.push(`미션 설명: ${missionDescription}`);
  }

  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `${contextLines.join("\n")}\n\n대화 기록:\n${transcriptText}\n\n위 대화를 분석해 JSON으로 피드백을 생성해주세요.`,
    },
  ];
};

const cleanJson = (raw: string): string =>
  raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();

const parseFeedbackLlm = (rawContent: string): FeedbackLlmResult | null => {
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
  return {
    metrics: {
      kindness: data.kindness,
      initiative: data.initiative,
      empathy: data.empathy,
      questionLink: data.questionLink,
    },
    missionSummary: data.missionSummary,
    summaryChips: data.summaryChips,
    savedPhrase: data.savedPhrase,
  };
};

const callOnce = async (messages: UpstageChatMessage[]): Promise<FeedbackLlmResult | null> => {
  const result = await callUpstageChat(messages, {
    temperature: TEMPERATURE,
    maxTokens: MAX_TOKENS,
    jsonMode: true,
  });
  if (!result.ok) {
    logger.warn({ reason: result.reason }, "피드백 LLM 호출 실패");
    return null;
  }
  return parseFeedbackLlm(result.content);
};

// 진입점. 1회 재시도 후에도 실패하면 null — 호출부(feedback.service)가 status=failed로 남긴다.
// 미션 추천과 달리 실패 시 가짜 분석으로 대체하지 않는다(허위 피드백 방지).
export const generateFeedbackWithLlm = async (
  transcript: FeedbackTranscriptMessage[],
  missionTitle: string,
  missionDescription: string | null
): Promise<FeedbackLlmResult | null> => {
  const messages = buildFeedbackMessages(transcript, missionTitle, missionDescription);

  const first = await callOnce(messages);
  if (first) return first;

  logger.warn("피드백 LLM 1차 실패 — 재시도");
  const retry = await callOnce(messages);
  if (retry) return retry;

  logger.warn("피드백 LLM 재시도까지 실패");
  return null;
};

// 서비스 계층에서 지표 순서를 고정해 순회할 때 쓴다.
export { FEEDBACK_METRIC_KEYS };
