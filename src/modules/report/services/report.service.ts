// modules/report/services/report.service.ts
import { withObjectParticle, withSubjectParticle } from "../../../shared/utils/korean";
import * as feedbackRepository from "../../feedback/repositories/feedback.repository";
import { FEEDBACK_METRIC_KEYS, FEEDBACK_METRIC_LABELS, FeedbackMetricKey } from "../../feedback/dtos/feedback.constants";
import * as reportRepository from "../repositories/report.repository";
import { MetricChangeDto, WeeklyCompareResponseDto, WeeklySnapshotDto } from "../dtos/report.dto";

// 주 경계는 월요일 시작(KST 기준 별도 타임존 보정 없이 서버 로컬 시간대의 UTC 계산 사용).
// 이 프로젝트에 타임존 인프라가 없어 다른 날짜 계산도 같은 방식(네이티브 Date, UTC 기준)을 쓴다.
export interface WeekRange {
  from: Date;
  to: Date; // exclusive
}

export const startOfWeekMonday = (date: Date): Date => {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay(); // 0=일 ... 6=토
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diffToMonday);
  return d;
};

const addDays = (date: Date, days: number): Date => {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
};

// 순수 함수로 분리 — 오늘 날짜가 어디서 주어지든(테스트에서 고정 날짜 주입) 결정론적으로 계산된다.
export const computeThisAndLastWeek = (now: Date): { thisWeek: WeekRange; lastWeek: WeekRange } => {
  const thisWeekStart = startOfWeekMonday(now);
  const thisWeekEnd = addDays(thisWeekStart, 7);
  const lastWeekStart = addDays(thisWeekStart, -7);
  return {
    thisWeek: { from: thisWeekStart, to: thisWeekEnd },
    lastWeek: { from: lastWeekStart, to: thisWeekStart },
  };
};

const buildSnapshot = async (userId: string, range: WeekRange): Promise<WeeklySnapshotDto> => {
  const [completedMissionCount, xpSum, metricAvg] = await Promise.all([
    reportRepository.countCompletedMissionsInRange(userId, range.from, range.to),
    reportRepository.sumXpEarnedInRange(userId, range.from, range.to),
    feedbackRepository.aggregateMetricAveragesInRange(userId, range.from, range.to),
  ]);

  // 해당 주에 피드백이 하나도 없으면(avg=null) 모든 지표는 0으로 처리한다(명세 참고).
  const metrics: Record<FeedbackMetricKey, number> = {
    kindness: Math.round(metricAvg._avg.kindness_score ?? 0),
    initiative: Math.round(metricAvg._avg.initiative_score ?? 0),
    empathy: Math.round(metricAvg._avg.empathy_score ?? 0),
    questionLink: Math.round(metricAvg._avg.question_link_score ?? 0),
  };

  return {
    completedMissionCount,
    xpEarned: xpSum._sum.amount ?? 0,
    metrics,
  };
};

const overallOf = (metrics: Record<FeedbackMetricKey, number>): number =>
  Math.round(
    FEEDBACK_METRIC_KEYS.reduce((sum, key) => sum + metrics[key], 0) / FEEDBACK_METRIC_KEYS.length
  );

// 지난 주 대비 XP 증감률. 지난 주가 0이면 나눗셈이 정의되지 않으므로:
// 이번 주도 0이면 변화 없음(0%), 이번 주가 0보다 크면 100%(무에서 유로 성장)로 근사한다.
export const computeXpChangeRate = (thisWeekXp: number, lastWeekXp: number): number => {
  if (lastWeekXp === 0) {
    return thisWeekXp === 0 ? 0 : 100;
  }
  return Math.round(((thisWeekXp - lastWeekXp) / lastWeekXp) * 1000) / 10; // 소수 첫째 자리
};

export const buildMetricChanges = (
  lastWeek: Record<FeedbackMetricKey, number>,
  thisWeek: Record<FeedbackMetricKey, number>
): MetricChangeDto[] =>
  FEEDBACK_METRIC_KEYS.map((key) => ({
    key,
    label: FEEDBACK_METRIC_LABELS[key],
    from: lastWeek[key],
    to: thisWeek[key],
    delta: thisWeek[key] - lastWeek[key],
  }));

// 증감폭이 큰 순서로 하이라이트 문구를 최대 3개 생성한다(서버 로직, LLM 미사용).
export const buildHighlights = (
  overallChange: { from: number; to: number; delta: number },
  metricChanges: MetricChangeDto[]
): string[] => {
  type Candidate = { absDelta: number; text: string };
  const candidates: Candidate[] = [];

  if (overallChange.delta !== 0) {
    const verb = overallChange.delta > 0 ? "상승했어요" : "낮아졌어요";
    candidates.push({
      absDelta: Math.abs(overallChange.delta),
      text: `전체 점수가 ${overallChange.from}점에서 ${overallChange.to}점으로 ${verb}`,
    });
  }

  const sortedMetricChanges = [...metricChanges].sort(
    (a, b) => Math.abs(b.delta) - Math.abs(a.delta)
  );

  for (const change of sortedMetricChanges) {
    if (change.delta === 0) continue;
    const text =
      change.delta > 0
        ? `${withSubjectParticle(change.label)} 가장 많이 상승했어요`
        : `${withObjectParticle(change.label)} 조금 더 신경 써보면 좋겠어요`;
    candidates.push({ absDelta: Math.abs(change.delta), text });
  }

  return candidates
    .sort((a, b) => b.absDelta - a.absDelta)
    .slice(0, 3)
    .map((c) => c.text);
};

// GET /reports/weekly-compare 진입점. 인증된 사용자의 이번 주/지난 주를 비교한다.
export const getWeeklyCompareReport = async (userId: string): Promise<WeeklyCompareResponseDto> => {
  const { thisWeek: thisWeekRange, lastWeek: lastWeekRange } = computeThisAndLastWeek(new Date());

  const [thisWeek, lastWeek] = await Promise.all([
    buildSnapshot(userId, thisWeekRange),
    buildSnapshot(userId, lastWeekRange),
  ]);

  const overallTo = overallOf(thisWeek.metrics);
  const overallFrom = overallOf(lastWeek.metrics);
  const overallScoreChange = { from: overallFrom, to: overallTo, delta: overallTo - overallFrom };
  const metricChanges = buildMetricChanges(lastWeek.metrics, thisWeek.metrics);

  return {
    thisWeek,
    lastWeek,
    xpChangeRate: computeXpChangeRate(thisWeek.xpEarned, lastWeek.xpEarned),
    overallScoreChange,
    metricChanges,
    highlights: buildHighlights(overallScoreChange, metricChanges),
  };
};
