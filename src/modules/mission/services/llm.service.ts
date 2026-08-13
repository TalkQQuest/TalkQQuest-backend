import { z } from "zod";
import { logger } from "../../../config/logger";
import { stripCodeFence, callUpstageChat, upstageModel } from "../../../shared/ai";
import { LlmHealthResponseDto, SetupGuidelineDto, setupGuidelineSchema } from "../dtos/mission.dto";
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

const MAX_TOKENS = 900;
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
  // 대화 전 준비 팁 / 주의사항. 사용자에게 그대로 노출되므로 비어있지 않아야 한다.
  preparation_tip: z.string().min(1),
  caution: z.string().min(1),
  // 별도 검증하여 이 필드만 깨진 경우 정상 미션까지 폴백하지 않는다.
  setup_guideline: z.unknown().optional(),
});

const llmSetupGuidelineSchema = setupGuidelineSchema.pick({
  defaults: true,
  disabled: true,
  tags: true,
});

const normalizeSetupGuideline = (raw: unknown): SetupGuidelineDto | null => {
  const parsed = llmSetupGuidelineSchema.safeParse(raw);
  if (!parsed.success) {
    logger.warn(
      { issues: parsed.error.issues },
      "LLM setupGuideline 스키마 검증 실패 — 미션은 유지하고 가이드라인만 제외"
    );
    return null;
  }

  const { defaults } = parsed.data;
  const disabled = {
    environment: parsed.data.disabled.environment.filter((value) => value !== defaults.environment),
    partnerRole: parsed.data.disabled.partnerRole.filter((value) => value !== defaults.partnerRole),
    intimacyLevel: parsed.data.disabled.intimacyLevel.filter(
      (value) => value !== defaults.intimacyLevel
    ),
    formalityLevel: parsed.data.disabled.formalityLevel.filter(
      (value) => value !== defaults.formalityLevel
    ),
    partnerGender: parsed.data.disabled.partnerGender.filter(
      (value) => value !== defaults.partnerGender
    ),
    partnerAgeGroup: parsed.data.disabled.partnerAgeGroup.filter(
      (value) => value !== defaults.partnerAgeGroup
    ),
  };
  const tags = [...new Set(parsed.data.tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, 5);

  return { defaults, disabled, tags, note: null, recommendedTopics: [] };
};

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

const SYSTEM_PROMPT = `당신은 사회적 행동 미션 추천 AI입니다.
사용자의 성향·관심사·목표·최근 수행 이력을 바탕으로 '현실에서 실제 수행 가능한' 대화 미션을 1개 생성합니다.

규칙:
- targetDifficulty(1=쉬움, 2=보통, 3=어려움)에 맞춰 난이도를 정합니다.
- growth(최근 대화 피드백 요약)가 있으면 우선 반영합니다.
  - growth.improvements에 있는 부분을 연습할 수 있는 미션을 고릅니다.
  - growth.struggleSituations에 있는 상황은 **피하지 말고**, 난이도를 낮춰 다시 다룰 수 있게 합니다.
    막히는 상황을 계속 피하면 연습할 기회 자체가 사라지기 때문입니다.
  - growth.strengths는 이미 잘하는 부분이므로 미션의 중심으로 삼지 않습니다.
- goals(사용자 목표)와 interests(관심사)를 미션에 자연스럽게 반영합니다.
- practiceTypes(사용자가 연습하고 싶은 대화 유형)가 있으면 우선 반영합니다.
- 개인정보를 요구하거나 위험·불쾌한 접근을 유도하는 미션은 절대 만들지 않습니다.

reason과 expected_effect 작성 규칙 (사용자에게 그대로 보여지는 문구입니다):
- 사용자에게 말하듯 자연스러운 한국어로 씁니다.
- 입력 데이터를 절대 언급하지 마세요. 필드명(targetDifficulty, interests, goals 등), 원본 값, JSON, 프롬프트를 그대로 인용하면 안 됩니다.
- 정보가 부족하다는 사실을 언급하지 마세요. ("관심사 정보가 없어서", "데이터가 부족하지만" 같은 표현 금지)
- 시스템 내부 사정이 아니라, 이 미션이 사용자에게 왜 좋은지만 설명합니다.

preparation_tip과 caution 작성 규칙 (사용자에게 그대로 보여지는 문구입니다):
- preparation_tip: 이 미션을 시작하기 전에 도움이 될 준비 팁을 1~2문장으로 씁니다 (예: "상대방이 바쁠 수 있으니 짧고 자연스럽게 말을 걸어보세요").
- caution: 이 미션을 수행할 때 주의할 점을 1문장으로 씁니다 (예: "상대방이 응답을 원치 않아 보이면 대화를 억지로 이어가지 않습니다").
- 위 reason/expected_effect와 같은 원칙을 따릅니다: 입력 데이터를 언급하지 않고, 자연스러운 한국어로 씁니다.

setup_guideline 작성 규칙:
- defaults는 가장 자연스럽고 추천되는 초기 선택값입니다. disabled는 추천 순위가 아니라 선택 자체의 허용 여부입니다. 둘을 서로 독립적으로 판단합니다.
- "덜 추천됨", "어색함", "흔하지 않음", "일반적이지 않음"은 disabled 사유가 아닙니다. 기본 추천값이 아닌 선택지도 이 이유만으로 막지 않습니다.
- disabled에는 선택했을 때 미션의 핵심 전제와 명백히 충돌하여 대화 시뮬레이션 자체가 성립하기 어려운 값만 넣습니다.
- 현실적으로 가능한 상황은 모두 허용합니다. 판단이 조금이라도 애매하면 disabled에 넣지 않고 허용합니다.
- intimacyLevel과 formalityLevel의 1 또는 5 같은 극단값도 단순히 부자연스럽거나 덜 추천된다는 이유로 제한하지 않습니다. 핵심 전제와 명백히 충돌할 때만 제한합니다.
- partnerGender와 partnerAgeGroup은 미션 자체에서 특정 성별이나 연령이 필수라는 전제가 명시된 경우가 아니면 반드시 빈 배열로 둡니다.
- partnerRole도 미션 설명에서 특정 인간관계가 핵심 전제로 명시된 경우에만 disabled 값을 넣습니다.
- 예: "친구에게 사과하기"처럼 친구 관계가 반드시 필요하면 friend 외 일부 역할을 제한할 수 있습니다.
- 반대로 "카페 직원에게 인사하기", "가게 주인과 대화하기"처럼 직원·주인이 상황적 대화 대상일 뿐 특정 인간관계를 전제하지 않는 미션은 disabled.partnerRole을 빈 배열로 둡니다.
- 예: "이웃 가게 주인과 간단한 안부 인사 나누기"는 친밀도나 격식 수준이 다양해도 현실적으로 가능하므로 intimacyLevel과 formalityLevel을 포함한 disabled 배열을 비워 둡니다.
- 대부분의 미션에서 disabled의 모든 배열이 빈 배열인 결과는 정상이며 권장됩니다.
- defaults.partnerGender는 필수이며 반드시 문자열 "male" 또는 "female" 중 하나만 사용합니다.
- 상대 성별이 미션 수행에 중요하지 않거나 특정되지 않아도 기본 추천값으로 "male" 또는 "female" 중 하나를 반드시 선택합니다.
- defaults.partnerGender에 "other", "any", "unknown", null 또는 그 밖의 값을 절대 생성하지 않습니다.
- disabled.partnerGender에도 "male"과 "female" 외의 값은 절대 넣지 않습니다.

- 반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트는 절대 포함하지 마세요.
{
  "mission_title": "string",
  "mission_description": "string (1~2문장, 구체적 행동)",
  "difficulty": 1~3 정수,
  "estimated_minutes": 정수,
  "category": "string",
  "reason": "이 미션을 추천한 이유",
  "expected_effect": "기대 효과",
  "preparation_tip": "대화 전 준비 팁 (1~2문장)",
  "caution": "수행 시 주의할 점 (1문장)",
  "setup_guideline": {
    "defaults": {
      "environment": "school | workplace | daily_place | community | online 중 하나",
      "partnerRole": "friend | senior | junior | peer | other 중 하나",
      "intimacyLevel": "1~5 정수",
      "formalityLevel": "1~5 정수",
      "partnerGender": "female",
      "partnerAgeGroup": "teens | twenties | thirties | forties | fifties | sixties_plus 중 하나"
    },
    "disabled": {
      "environment": "상황과 명백히 모순되는 environment 값만 담은 배열(대부분 [])",
      "partnerRole": "특정 인간관계가 핵심 전제로 명시된 경우에만 막을 값을 담은 배열(상황적 대상이면 반드시 [])",
      "intimacyLevel": "핵심 전제와 명백히 충돌해 선택 자체가 불가능한 1~5 정수만 담은 배열(대부분 [])",
      "formalityLevel": "핵심 전제와 명백히 충돌해 선택 자체가 불가능한 1~5 정수만 담은 배열(대부분 [])",
      "partnerGender": "미션에 특정 성별이 필수라고 명시된 경우에만 막을 값을 담은 배열(그 외 반드시 [])",
      "partnerAgeGroup": "미션에 특정 연령이 필수라고 명시된 경우에만 막을 값을 담은 배열(그 외 반드시 [])"
    },
    "tags": "미션 성격을 나타내는 짧은 한국어 태그 배열(최대 5개)"
  }
}`;

const nonEmpty = (values: string[]): string[] =>
  values.map((value) => value.trim()).filter((value) => value.length > 0);

// 2단계 criteria + 1단계 context를 LLM에 넘길 힌트 객체로 압축.
// 빈 값(빈 배열/null/공백)은 키 자체를 넣지 않는다 — 모델이 `goals: []` 같은 값을 그대로 인용하거나
// "정보가 부족하지만..." 하고 사용자에게 해설하는 것을 막기 위함.
const buildPromptHints = (context: UserContext, criteria: RecommendationCriteria) => {
  const hints: Record<string, unknown> = {
    targetDifficulty: criteria.targetDifficulty,
    isColdStart: criteria.isColdStart,
  };

  if (criteria.personalityType) {
    hints.personalityType = criteria.personalityType;
  }

  const interests = nonEmpty(criteria.preferredInterests);
  if (interests.length > 0) {
    hints.interests = interests;
  }

  const goals = nonEmpty(context.goals);
  if (goals.length > 0) {
    hints.goals = goals;
  }

  const practiceTypes = nonEmpty(context.practiceTypes);
  if (practiceTypes.length > 0) {
    hints.practiceTypes = practiceTypes;
  }

  if (context.recentMissions.length > 0) {
    // #150 — result는 넣지 않는다. 미션에 실패라는 개념이 없어 항상 success가 들어오므로
    // 모델에게 "전부 성공했다"는 잘못된 신호만 준다. 수행 성향은 아래 growth가 담당한다.
    hints.recentMissions = context.recentMissions.map((m) => ({
      title: m.title,
      category: m.category,
    }));
  }

  // #150 — 피드백 기반 성장 프로필. 프로필이 없거나 표본이 부족하면 통째로 빠진다.
  // 빈 항목은 키를 넣지 않는다(위 힌트들과 같은 이유 — 모델이 빈 값을 해설하는 것을 막는다).
  if (context.growth) {
    const growth: Record<string, unknown> = {};

    if (context.growth.summary) growth.summary = context.growth.summary;
    if (context.growth.strengths.length > 0) growth.strengths = context.growth.strengths;
    if (context.growth.improvements.length > 0) {
      growth.improvements = context.growth.improvements;
    }
    if (context.growth.struggleSituations.length > 0) {
      growth.struggleSituations = context.growth.struggleSituations;
    }

    if (Object.keys(growth).length > 0) hints.growth = growth;
  }

  return hints;
};

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
  let json: unknown;
  try {
    json = JSON.parse(stripCodeFence(rawContent));
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
      preparationTip: data.preparation_tip,
      caution: data.caution,
      source: "llm",
      setupGuideline: normalizeSetupGuideline(data.setup_guideline),
      recommendationLogId: null, // recommendation.service가 로깅 후 채운다
    },
  };
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
  const model = upstageModel();
  const messages = buildLlmMessages(context, criteria);

  const result = await callUpstageChat(messages, {
    temperature: TEMPERATURE,
    maxTokens: MAX_TOKENS,
    jsonMode: true,
  });

  if (!result.ok) {
    if (result.reason === "no_api_key") {
      logger.info("UPSTAGE_API_KEY 미설정 — LLM 생성을 건너뛰고 템플릿 폴백");
      return failedResult("no_api_key");
    }
    // 저수준 사유를 로깅용 fallback_reason으로 매핑한다.
    // empty_response(200이나 빈 content)는 파싱 불가이므로 invalid_json으로, 네트워크 오류는 http_error로 묶는다.
    const reason: LlmFallbackReason =
      result.reason === "timeout"
        ? "timeout"
        : result.reason === "empty_response"
          ? "invalid_json"
          : "http_error";
    logger.warn({ reason: result.reason }, "Upstage 실패 — 템플릿으로 폴백");
    return failedResult(reason, { llmModel: model, promptInput: messages });
  }

  const parsed = parseLlmMission(result.content);
  if (!parsed.ok) {
    return failedResult(parsed.reason, {
      llmModel: model,
      promptInput: messages,
      rawResponse: result.content,
    });
  }

  return {
    mission: parsed.mission,
    llmModel: model,
    promptInput: messages,
    rawResponse: result.content,
    parseSuccess: true,
    fallbackReason: null,
  };
};

// 진단용 — 사용자 데이터 없이 Upstage에 최소 요청을 보내 연결 상태만 확인한다.
export const pingLlm = async (): Promise<LlmHealthResponseDto> => {
  const model = upstageModel();
  const result = await callUpstageChat([{ role: "user", content: "Say OK" }], { maxTokens: 10 });

  if (result.ok) {
    return { connected: true, model, sample: result.content.slice(0, 100) };
  }
  // 200이지만 빈 응답이면 서버 연결 자체는 정상으로 본다.
  if (result.reason === "empty_response") {
    return { connected: true, model, sample: "" };
  }
  if (result.reason === "http_error") {
    return { connected: false, model, reason: `http_${result.status}` };
  }
  return { connected: false, model, reason: result.reason }; // no_api_key / timeout / network_error
};
