// modules/growth/dtos/growth-profile.dto.ts
//
// 성장 프로필(User_Growth_Profiles)의 입력/산출 타입.
//
// 이 프로필은 "이 사용자가 무엇을 잘하고 어디서 막히는가"를 사용자당 1행으로 요약한 것이고,
// 미션 추천이 읽는 유일한 이력 소스다. 추천 때마다 대화 원문과 피드백을 조인해 프롬프트에
// 넣으면 토큰·지연이 대화 수에 비례해 늘기 때문에, 피드백이 완성될 때 미리 요약해 둔다.
//
// 산출은 두 갈래로 나뉜다.
//  - 결정론적 계산: 지표 평균/추세, 막히는 상황 집계, 반영 건수 (LLM 불필요)
//  - LLM 생성: 서술 요약, 강점/개선점, 제안 난이도
// 숫자 집계를 LLM에 맡기면 검증할 수 없는 값이 프로필에 남으므로 서버가 직접 센다.

import { z } from "zod";

// 피드백 지표 4종. Feedbacks의 *_score 컬럼과 1:1로 대응한다.
export const METRIC_KEYS = ["kindness", "initiative", "empathy", "questionLink"] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

// 지표가 이 점수 미만이면 "그 대화에서 막혔다"로 본다(점수 척도는 0~100).
// Mission_Records.result가 아니라 이 값을 쓰는 이유 — 미션에 실패라는 개념이 없어
// result는 항상 success로 들어오므로 신호가 되지 못한다.
export const LOW_SCORE_THRESHOLD = 60;

// 요약을 신뢰하려면 최소 이만큼의 피드백이 반영돼 있어야 한다.
// 1건짜리 요약은 그날의 컨디션을 사용자의 성향으로 오해할 수 있다.
export const MIN_FEEDBACKS_FOR_PROFILE = 2;

// 한 번에 요약에 넣을 최근 피드백 수. 전부 넣으면 프롬프트가 대화 수에 비례해 커진다.
export const SUMMARY_WINDOW = 10;

// 추세 판정 임계값(100점 척도). 최근 절반 평균과 이전 절반 평균의 차이가
// 이보다 작으면 flat으로 본다 — 점수는 LLM 채점이라 몇 점 흔들리는 것은 추세가 아니다.
export const TREND_DELTA_THRESHOLD = 5;

export type MetricTrend = "up" | "down" | "flat";

export interface MetricAverage {
  avg: number; // 최근 SUMMARY_WINDOW 건의 평균 (소수 1자리)
  trend: MetricTrend;
}

export type MetricAverages = Record<MetricKey, MetricAverage>;

// 반복해서 막힌 상황 1건.
// 카테고리만이 아니라 상황 축까지 담는 이유는 "카페는 괜찮은데 선배 상대만 막힌다"를
// 카테고리로는 표현할 수 없기 때문이다.
// Mission_Setups가 없던 시기의 대화는 environment/partnerRole이 null로 남는다.
export interface StruggleSituation {
  environment: string | null;
  partnerRole: string | null;
  category: string;
  // 이 조합에서 지표가 LOW_SCORE_THRESHOLD 미만으로 나온 횟수.
  // failCount가 아닌 이유는 집계 기준이 result가 아니라 지표 점수이기 때문이다.
  lowScoreCount: number;
}

// 집계 입력 1건 — 피드백 + 그 대화의 상황 축을 평탄화한 것.
export interface FeedbackSample {
  feedbackId: string;
  readyAt: Date;
  scores: Record<MetricKey, number | null>;
  conversationSummary: string | null;
  strengths: string[];
  improvements: string[];
  category: string;
  difficulty: number; // 그 대화의 미션 난이도(1~3). 제안 난이도의 기준점으로 쓴다.
  environment: string | null;
  partnerRole: string | null;
}

// LLM이 만들어낼 부분. 형식이 어긋나면 기존 프로필을 유지한다(아래 서비스 참고).
export const growthSummarySchema = z.object({
  summary: z.string().min(1).max(300),
  // 여러 대화에 걸쳐 반복된 항목만 남긴다. 개수 상한은 프롬프트에 적은 값과 일치해야 한다 —
  // 어긋나면 모델이 상한을 넘겨도 검증이 통과해 프로필이 장황해진다.
  strengths: z.array(z.string().min(1).max(80)).max(3),
  improvements: z.array(z.string().min(1).max(80)).max(3),
  suggestedDifficulty: z.number().int().min(1).max(3),
});

export type GrowthSummary = z.infer<typeof growthSummarySchema>;

// 추천이 읽는 형태. 프로필 행이 없거나 표본이 부족하면 호출부가 null을 받는다.
export interface GrowthProfileView {
  summary: string | null;
  strengths: string[];
  improvements: string[];
  struggleSituations: StruggleSituation[];
  metricAverages: MetricAverages | null;
  suggestedDifficulty: number | null;
  reflectedFeedbackCount: number;
}
