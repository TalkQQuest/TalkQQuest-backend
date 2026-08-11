// modules/growth/services/growth-summary.service.ts
//
// 성장 프로필의 **LLM 생성** 부분 — 서술 요약, 강점/개선점, 제안 난이도.
// 숫자 집계(지표 평균·막히는 상황)는 여기서 다루지 않는다(growth-aggregate.service.ts).
//
// 실패해도 예외를 던지지 않고 null을 반환한다. 성장 프로필은 추천을 **거들** 뿐이고,
// 여기서 던지면 피드백 생성(사용자가 기다리는 응답)까지 흔들린다.

import { logger } from "../../../config/logger";
import { callUpstageChat, parseJsonResponse } from "../../../shared/ai";
import {
  FeedbackSample,
  GrowthSummary,
  growthSummarySchema,
  MetricAverages,
  StruggleSituation,
} from "../dtos/growth-profile.dto";

const SUMMARY_MAX_TOKENS = 600;
const SUMMARY_TEMPERATURE = 0.4;

// 프롬프트에 넣을 상위 항목 수. 전부 넣으면 토큰이 커지고 모델이 나열에 끌려간다.
const MAX_STRUGGLE_SITUATIONS = 3;
const MAX_REPEATED_TEXTS = 5;
const MAX_CONVERSATION_SUMMARIES = 5;

// 강점·개선점 상한. **growthSummarySchema의 .max(3)과 반드시 같아야 한다** —
// 프롬프트가 5개까지 허용하는데 스키마가 3개로 자르면 매번 검증 실패로 요약이 통째로 버려진다.
const ITEM_LIMIT = 3;

const SYSTEM_PROMPT = `당신은 대화 연습 앱의 학습 코치입니다.
사용자의 최근 대화 피드백을 보고 "이 사람은 무엇을 잘하고 어디서 막히는가"를 정리합니다.

작성 규칙:
- summary는 사용자에게 직접 말하듯 2~3문장으로 씁니다. 지표 점수를 숫자로 나열하지 않습니다.
- strengths / improvements는 각각 최대 ${ITEM_LIMIT}개이며, **여러 대화에 걸쳐 반복된 것만** 씁니다.
  한 번만 나온 지적은 그 날의 상황일 수 있으므로 넣지 않습니다.
- 각 항목은 한 줄(80자 이내)로, 판정이 아니라 관찰로 씁니다.
- suggestedDifficulty는 다음 미션 난이도 제안입니다. 1=쉬움, 2=보통, 3=어려움.
  지표가 낮거나 하락 추세면 낮추고, 안정적으로 높으면 올립니다.
- 사용자를 평가하거나 단정하지 않습니다. 못한다/부족하다 같은 표현 대신 어떤 상황이 어려웠는지 씁니다.

반드시 아래 JSON 형식으로만 응답하세요.
{
  "summary": "string",
  "strengths": ["string"],
  "improvements": ["string"],
  "suggestedDifficulty": 1
}`;

// 프롬프트 입력을 만든다. 빈 값은 키 자체를 넣지 않는다 —
// 모델이 `strengths: []`를 그대로 인용하거나 "정보가 부족하지만..." 하고 해설하는 것을 막기 위함.
export const buildSummaryPromptInput = (params: {
  samples: FeedbackSample[]; // 최신순
  metricAverages: MetricAverages | null;
  struggleSituations: StruggleSituation[];
  repeatedStrengths: string[];
  repeatedImprovements: string[];
  recentDifficulty: number | null;
}): Record<string, unknown> => {
  const input: Record<string, unknown> = {
    feedbackCount: params.samples.length,
  };

  if (params.recentDifficulty !== null) {
    input.recentMissionDifficulty = params.recentDifficulty;
  }
  if (params.metricAverages) {
    input.metricAverages = params.metricAverages;
  }
  if (params.struggleSituations.length > 0) {
    input.struggleSituations = params.struggleSituations.slice(0, MAX_STRUGGLE_SITUATIONS);
  }
  if (params.repeatedStrengths.length > 0) {
    input.repeatedStrengths = params.repeatedStrengths.slice(0, MAX_REPEATED_TEXTS);
  }
  if (params.repeatedImprovements.length > 0) {
    input.repeatedImprovements = params.repeatedImprovements.slice(0, MAX_REPEATED_TEXTS);
  }

  const summaries = params.samples
    .map((s) => s.conversationSummary)
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .slice(0, MAX_CONVERSATION_SUMMARIES);
  if (summaries.length > 0) {
    input.recentConversationSummaries = summaries;
  }

  return input;
};

// 요약 생성. 실패(키 없음/타임아웃/형식 오류) 시 null —
// 호출부는 기존 프로필의 요약을 그대로 두고 숫자 집계만 갱신한다.
export const generateGrowthSummary = async (
  promptInput: Record<string, unknown>
): Promise<GrowthSummary | null> => {
  const result = await callUpstageChat(
    [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `다음은 사용자의 최근 대화 피드백 요약입니다:\n${JSON.stringify(
          promptInput,
          null,
          2
        )}\n\n위 데이터를 바탕으로 성장 요약을 JSON으로 작성해주세요.`,
      },
    ],
    { temperature: SUMMARY_TEMPERATURE, maxTokens: SUMMARY_MAX_TOKENS, jsonMode: true }
  );

  if (!result.ok) {
    logger.warn({ reason: result.reason }, "성장 요약 LLM 호출 실패 — 기존 요약 유지");
    return null;
  }

  return parseJsonResponse(result.content, growthSummarySchema, "성장 요약");
};
