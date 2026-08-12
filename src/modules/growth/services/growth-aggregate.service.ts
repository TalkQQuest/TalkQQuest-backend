// modules/growth/services/growth-aggregate.service.ts
//
// 성장 프로필의 **결정론적** 부분. 여기 있는 함수는 전부 순수 함수(I/O·AI 호출 없음)다.
//
// 지표 평균·추세와 "막히는 상황" 집계를 LLM에 맡기지 않는 이유: 숫자는 검증할 수 없는 값이
// 프로필에 남으면 추천이 통째로 어긋나는데, 서버가 직접 세면 항상 맞는다.
// LLM은 서술 요약처럼 숫자로 표현할 수 없는 부분만 담당한다(growth-summary.service.ts).

import {
  FeedbackSample,
  LOW_SCORE_THRESHOLD,
  METRIC_KEYS,
  MetricAverage,
  MetricAverages,
  MetricKey,
  MetricTrend,
  StruggleSituation,
  TREND_DELTA_THRESHOLD,
} from "../dtos/growth-profile.dto";

// Feedbacks.metrics는 [{ key, label, score, strengths, improvements, bestSentence }] 형태의
// Json 컬럼이라 unknown으로 들어온다. 형식이 어긋나도 집계 전체가 죽으면 안 되므로
// 문자열 배열만 안전하게 추출한다(어긋나면 빈 배열).
const extractMetricTexts = (
  metrics: unknown,
  field: "strengths" | "improvements"
): string[] => {
  if (!Array.isArray(metrics)) return [];

  const texts: string[] = [];
  for (const entry of metrics) {
    if (typeof entry !== "object" || entry === null) continue;
    const value = (entry as Record<string, unknown>)[field];
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (typeof item === "string" && item.trim().length > 0) texts.push(item.trim());
    }
  }
  return texts;
};

// Prisma 조회 결과(피드백 + 대화 → 미션/준비 정보) → 집계 입력으로 평탄화.
// ready_at이 null인 행은 레포지토리에서 이미 걸러지지만, 타입상 nullable이라 여기서 한 번 더 막는다.
export const toFeedbackSample = (row: {
  id: string;
  ready_at: Date | null;
  kindness_score: number | null;
  initiative_score: number | null;
  empathy_score: number | null;
  question_link_score: number | null;
  metrics: unknown;
  conversation_summary: string | null;
  conversation: {
    mission: { category: string; difficulty: number };
    mission_setup: { environment: string; partner_role: string } | null;
  };
}): FeedbackSample | null => {
  if (!row.ready_at) return null;

  return {
    feedbackId: row.id,
    readyAt: row.ready_at,
    scores: {
      kindness: row.kindness_score,
      initiative: row.initiative_score,
      empathy: row.empathy_score,
      questionLink: row.question_link_score,
    },
    conversationSummary: row.conversation_summary,
    strengths: extractMetricTexts(row.metrics, "strengths"),
    improvements: extractMetricTexts(row.metrics, "improvements"),
    category: row.conversation.mission.category,
    difficulty: row.conversation.mission.difficulty,
    // Mission_Setups 도입 이전 대화는 상황 축을 알 수 없다. 이 경우 지표 평균에는 포함하되
    // 막히는 상황 집계에서만 빠진다(아래 collectStruggleSituations 참고).
    environment: row.conversation.mission_setup?.environment ?? null,
    partnerRole: row.conversation.mission_setup?.partner_role ?? null,
  };
};

const average = (values: number[]): number =>
  Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 10) / 10;

// 추세는 최근 절반과 이전 절반의 평균 차이로 본다.
// 인접 2건 비교로는 LLM 채점의 흔들림이 그대로 추세로 읽히고, 전체 회귀는 표본이 적어 과하다.
const decideTrend = (chronological: number[]): MetricTrend => {
  // 표본이 4건 미만이면 절반으로 갈라도 각 구간이 1건이라 흔들림과 추세를 구분할 수 없다.
  if (chronological.length < 4) return "flat";

  const mid = Math.floor(chronological.length / 2);
  const delta = average(chronological.slice(mid)) - average(chronological.slice(0, mid));

  if (delta >= TREND_DELTA_THRESHOLD) return "up";
  if (delta <= -TREND_DELTA_THRESHOLD) return "down";
  return "flat";
};

// 지표 4종의 평균과 추세. samples는 **오래된 순**으로 들어와야 추세 방향이 맞는다.
// 채점되지 않은 지표(null)는 그 지표에서만 빠진다 — 한 지표가 비었다고 나머지를 버릴 이유가 없다.
// 어떤 지표도 값이 없으면 null을 반환해 호출부가 "평균 없음"과 "평균 0"을 구분할 수 있게 한다.
export const computeMetricAverages = (samples: FeedbackSample[]): MetricAverages | null => {
  const result = {} as MetricAverages;
  let hasAny = false;

  for (const key of METRIC_KEYS) {
    const values = samples
      .map((s) => s.scores[key])
      .filter((v): v is number => typeof v === "number");

    // #188 — 채점된 값이 없는 지표는 키를 넣지 않는다. avg: 0을 넣으면 "채점 안 됨"이
    // "0점"으로 읽혀, 이 값을 참고하는 추천 난이도 판단이 부당하게 낮아질 수 있다.
    if (values.length === 0) continue;

    hasAny = true;
    result[key] = { avg: average(values), trend: decideTrend(values) };
  }

  return hasAny ? result : null;
};

const situationKey = (s: FeedbackSample): string =>
  `${s.environment ?? ""}|${s.partnerRole ?? ""}|${s.category}`;

// 지표가 LOW_SCORE_THRESHOLD 미만으로 나온 대화를 상황 조합별로 센다.
//
// 한 대화에서 지표 여러 개가 낮아도 1로 센다. 지표 수만큼 세면 "네 지표가 모두 낮은 대화 1건"이
// "한 지표만 낮은 대화 4건"과 같은 무게가 되는데, 반복성을 보려는 집계라 대화 수가 맞다.
//
// 상황 축이 없는 대화(Mission_Setups 도입 이전)는 제외한다. environment/partnerRole이 모두
// null인 항목을 남기면 서로 다른 상황이 하나로 뭉쳐 "이 조합에서 막힌다"가 성립하지 않는다.
export const collectStruggleSituations = (samples: FeedbackSample[]): StruggleSituation[] => {
  const counts = new Map<string, StruggleSituation>();

  for (const sample of samples) {
    if (!sample.environment && !sample.partnerRole) continue;

    const scored = METRIC_KEYS.map((k) => sample.scores[k]).filter(
      (v): v is number => typeof v === "number"
    );
    if (scored.length === 0) continue;
    if (!scored.some((score) => score < LOW_SCORE_THRESHOLD)) continue;

    const key = situationKey(sample);
    const existing = counts.get(key);
    if (existing) {
      existing.lowScoreCount += 1;
      continue;
    }
    counts.set(key, {
      environment: sample.environment,
      partnerRole: sample.partnerRole,
      category: sample.category,
      lowScoreCount: 1,
    });
  }

  // 많이 막힌 조합이 앞에 오도록 정렬한다. 프롬프트에 상위 몇 개만 넣을 때 순서가 곧 우선순위다.
  return [...counts.values()].sort((a, b) => b.lowScoreCount - a.lowScoreCount);
};

// 여러 대화에 걸쳐 반복된 항목만 남긴다. 1회성 지적을 성향으로 굳히지 않기 위함이다.
// 표현이 조금씩 달라 완전 일치로는 거의 안 겹치므로, 공백·문장부호를 지운 뒤 비교한다.
const normalizeForCount = (text: string): string =>
  text.toLowerCase().replace(/[\s.,!?~…·"'`]/g, "");

export const collectRepeatedTexts = (lists: string[][], minCount: number): string[] => {
  const counts = new Map<string, { text: string; count: number }>();

  for (const list of lists) {
    // 같은 대화 안에서 중복된 표현은 1회로 센다 — 반복은 대화 사이에서 일어나야 의미가 있다.
    const seen = new Set<string>();
    for (const text of list) {
      const key = normalizeForCount(text);
      if (key.length === 0 || seen.has(key)) continue;
      seen.add(key);

      const existing = counts.get(key);
      if (existing) existing.count += 1;
      else counts.set(key, { text, count: 1 });
    }
  }

  return [...counts.values()]
    .filter((entry) => entry.count >= minCount)
    .sort((a, b) => b.count - a.count)
    .map((entry) => entry.text);
};
