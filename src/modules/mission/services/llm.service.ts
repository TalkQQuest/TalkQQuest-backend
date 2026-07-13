import { z } from "zod";
import { env } from "../../../config/env";
import { logger } from "../../../config/logger";
import { LlmHealthResponseDto } from "../dtos/mission.dto";
import {
  RecommendationCriteria,
  RecommendedMission,
  UserContext,
} from "../dtos/recommendation.dto";

// 4단계 — LLM(Upstage Solar) 미션 생성.
// "AI는 생성만, 서버가 판단" 원칙: 2단계에서 계산한 criteria(목표 난이도, 회피 카테고리 등)를
// 프롬프트에 "힌트"로 넘기고, LLM은 그 범위 안에서 미션 문구만 창의적으로 만든다.
// 어떤 이유로든(키 없음/HTTP 오류/타임아웃/JSON 깨짐/필드 누락) 실패하면 mission=null을 담아
// 호출부(recommendMission)가 3단계 템플릿 폴백으로 넘어가게 한다. 실패 사유는 로깅용으로 함께 반환한다.

// 폴백 사유 — Recommendation_Logs.fallback_reason에 그대로 저장된다.
export type LlmFallbackReason =
  | "no_api_key"
  | "http_error"
  | "invalid_json"
  | "schema_invalid"
  | "timeout";

// generateMissionWithLlm 결과. 추천 미션 + 로깅에 필요한 세부 정보를 함께 담는다.
export interface LlmGenerationResult {
  mission: RecommendedMission | null; // 성공 시 생성 미션, 실패 시 null(→ 템플릿 폴백)
  llmModel: string | null; // 호출 시도한 모델명 (키 없으면 null)
  promptInput: ChatMessage[] | null; // LLM에 보낸 메시지 (키 없으면 null)
  rawResponse: string | null; // LLM 원문 응답 content
  parseSuccess: boolean; // 파싱/스키마 검증 성공 여부
  fallbackReason: LlmFallbackReason | null; // 폴백 사유, 성공 시 null
}

// parseLlmMission 결과 — 실패 사유(invalid_json/schema_invalid)를 구분해 로깅에 쓴다.
export type ParseResult =
  | { ok: true; mission: RecommendedMission }
  | { ok: false; reason: "invalid_json" | "schema_invalid" };

const REQUEST_TIMEOUT_MS = 10000;
const MAX_TOKENS = 500;
const TEMPERATURE = 0.7;

// LLM이 반드시 이 형태의 JSON만 반환하도록 프롬프트로 강제하고, 응답도 이 스키마로 검증한다.
const llmMissionSchema = z.object({
  mission_title: z.string().min(1),
  mission_description: z.string().min(1),
  difficulty: z.number().int().min(1).max(3),
  estimated_minutes: z.number().int().positive(),
  category: z.string().min(1),
  reason: z.string().min(1),
  expected_effect: z.string().min(1),
});

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

const SYSTEM_PROMPT = `당신은 사회적 행동 미션 추천 AI입니다.
사용자의 성향·관심사·목표·최근 수행 이력을 바탕으로 '현실에서 실제 수행 가능한' 대화 미션을 1개 생성합니다.

규칙:
- targetDifficulty(1=쉬움, 2=보통, 3=어려움)에 맞춰 난이도를 정합니다.
- avoidedCategories에 있는 유형은 피하고 대체 유형을 제안합니다.
- goals(사용자 목표)와 interests(관심사)를 미션에 자연스럽게 반영합니다.
- practiceTypes(사용자가 연습하고 싶은 대화 유형)가 있으면 우선 반영합니다.
- 개인정보를 요구하거나 위험·불쾌한 접근을 유도하는 미션은 절대 만들지 않습니다.
- 반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트는 절대 포함하지 마세요.
{
  "mission_title": "string",
  "mission_description": "string (1~2문장, 구체적 행동)",
  "difficulty": 1~3 정수,
  "estimated_minutes": 정수,
  "category": "string",
  "reason": "이 미션을 추천한 이유",
  "expected_effect": "기대 효과"
}`;

// 2단계 criteria + 1단계 context를 LLM에 넘길 힌트 객체로 압축.
const buildPromptHints = (context: UserContext, criteria: RecommendationCriteria) => ({
  targetDifficulty: criteria.targetDifficulty,
  avoidedCategories: criteria.avoidedCategories,
  personalityType: criteria.personalityType,
  interests: criteria.preferredInterests,
  goals: context.goals,
  practiceTypes: context.practiceTypes,
  isColdStart: criteria.isColdStart,
  recentMissions: context.recentMissions.map((m) => ({
    title: m.title,
    category: m.category,
    result: m.result,
  })),
});

// 프롬프트(messages)는 순수 함수로 만들어 단독 검증이 가능하게 한다.
export const buildLlmMessages = (
  context: UserContext,
  criteria: RecommendationCriteria
): ChatMessage[] => [
  { role: "system", content: SYSTEM_PROMPT },
  {
    role: "user",
    content: `다음은 사용자 데이터입니다:\n${JSON.stringify(
      buildPromptHints(context, criteria),
      null,
      2
    )}\n\n위 데이터를 바탕으로 미션 1개를 JSON으로 추천해주세요.`,
  },
];

// LLM 원문 응답 → RecommendedMission. 실패 시 사유를 담아 반환 (호출부가 템플릿 폴백 + 로깅).
export const parseLlmMission = (rawContent: string): ParseResult => {
  // 모델이 ```json 코드펜스로 감싸는 경우를 벗겨낸다.
  const cleaned = rawContent
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();

  let json: unknown;
  try {
    json = JSON.parse(cleaned);
  } catch {
    logger.warn("LLM 응답 JSON 파싱 실패 — 템플릿으로 폴백");
    return { ok: false, reason: "invalid_json" };
  }

  const parsed = llmMissionSchema.safeParse(json);
  if (!parsed.success) {
    logger.warn({ issues: parsed.error.issues }, "LLM 응답 스키마 검증 실패 — 템플릿으로 폴백");
    return { ok: false, reason: "schema_invalid" };
  }

  const data = parsed.data;
  return {
    ok: true,
    mission: {
      missionId: null, // LLM 생성 미션은 아직 DB에 저장하지 않았으므로 null
      title: data.mission_title,
      description: data.mission_description,
      difficulty: data.difficulty,
      estimatedMinutes: data.estimated_minutes,
      category: data.category,
      rewardXp: data.difficulty * 10, // 템플릿과 동일한 난이도 비례 보상 규칙
      reason: data.reason,
      expectedEffect: data.expected_effect,
      source: "llm",
    },
  };
};

const fetchWithTimeout = async (url: string, init: RequestInit): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
};

// 실패 결과 헬퍼 — mission=null과 폴백 사유를 담는다.
const failedResult = (
  fallbackReason: LlmFallbackReason,
  extra: Partial<LlmGenerationResult> = {}
): LlmGenerationResult => ({
  mission: null,
  llmModel: null,
  promptInput: null,
  rawResponse: null,
  parseSuccess: false,
  fallbackReason,
  ...extra,
});

// 4단계 진입점. 항상 LlmGenerationResult를 반환한다(성공 시 mission 채움, 실패 시 mission=null + 사유).
export const generateMissionWithLlm = async (
  context: UserContext,
  criteria: RecommendationCriteria
): Promise<LlmGenerationResult> => {
  if (!env.UPSTAGE_API_KEY) {
    logger.info("UPSTAGE_API_KEY 미설정 — LLM 생성을 건너뛰고 템플릿 폴백");
    return failedResult("no_api_key");
  }

  const model = env.UPSTAGE_MODEL;
  const messages = buildLlmMessages(context, criteria);

  try {
    const res = await fetchWithTimeout(`${env.UPSTAGE_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.UPSTAGE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: TEMPERATURE,
        max_tokens: MAX_TOKENS,
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      logger.warn({ status: res.status }, "Upstage 응답 오류 — 템플릿으로 폴백");
      return failedResult("http_error", { llmModel: model, promptInput: messages });
    }

    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = body.choices?.[0]?.message?.content;
    if (!content) {
      logger.warn("Upstage 응답에 content가 없음 — 템플릿으로 폴백");
      return failedResult("invalid_json", { llmModel: model, promptInput: messages });
    }

    const parsed = parseLlmMission(content);
    if (!parsed.ok) {
      return failedResult(parsed.reason, {
        llmModel: model,
        promptInput: messages,
        rawResponse: content,
      });
    }

    return {
      mission: parsed.mission,
      llmModel: model,
      promptInput: messages,
      rawResponse: content,
      parseSuccess: true,
      fallbackReason: null,
    };
  } catch (error) {
    // 타임아웃(AbortError)과 그 외 네트워크 오류를 구분해 폴백으로 흡수한다.
    const isTimeout = error instanceof Error && error.name === "AbortError";
    logger.warn({ err: error }, "Upstage 호출 실패 — 템플릿으로 폴백");
    return failedResult(isTimeout ? "timeout" : "http_error", {
      llmModel: model,
      promptInput: messages,
    });
  }
};

// 진단용 — 사용자 데이터 없이 Upstage에 최소 요청을 보내 연결 상태만 확인한다.
export const pingLlm = async (): Promise<LlmHealthResponseDto> => {
  const model = env.UPSTAGE_MODEL;
  if (!env.UPSTAGE_API_KEY) {
    return { connected: false, model, reason: "no_api_key" };
  }

  try {
    const res = await fetchWithTimeout(`${env.UPSTAGE_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.UPSTAGE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Say OK" }],
        max_tokens: 10,
      }),
    });

    if (!res.ok) {
      return { connected: false, model, reason: `http_${res.status}` };
    }

    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = body.choices?.[0]?.message?.content ?? "";
    return { connected: true, model, sample: content.slice(0, 100) };
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === "AbortError";
    return { connected: false, model, reason: isTimeout ? "timeout" : "network_error" };
  }
};
