import { withSubjectParticle } from "../../../shared/utils/korean";
import * as reportRepository from "../repositories/report.repository";
import {
  MetricChangeDto,
  WeeklyActivityDto,
  WeeklyCompareReportDto,
  WeeklyMetricsDto,
} from "../dtos/report.dto";
import { addDays, getWeekStart } from "./week-window";

// GET /reports/weekly-compare 자체는 최유경 님 담당이지만, POST /reports(type: weekly_compare)로
// 스냅샷을 저장하려면 동일한 라이브 계산 로직이 필요하다. 컨트롤러 라우트는 노출하지 않고
// 저장(report.service.ts)에서만 내부적으로 사용한다 — 실제 GET 엔드포인트 구현은 최유경 님 몫.

const METRIC_DEFS = [
  { key: "kindness" as const, label: "친절한 태도" },
  { key: "initiative" as const, label: "대화 주도" },
  { key: "empathy" as const, label: "공감 능력" },
  { key: "questionLink" as const, label: "질문 연결성" },
];

const average = (scores: (number | null)[]): number => {
  const valid = scores.filter((score): score is number => score !== null);
  if (valid.length === 0) return 0;
  return Math.round(valid.reduce((sum, score) => sum + score, 0) / valid.length);
};

const getWeekActivity = async (userId: string, start: Date, end: Date): Promise<WeeklyActivityDto> => {
  const [completedMissionCount, xpEarned, feedbackScores] = await Promise.all([
    reportRepository.countCompletedMissionRecordsInRange(userId, start, end),
    reportRepository.sumXpAmountInRange(userId, start, end),
    reportRepository.findFeedbackScoresInRange(userId, start, end),
  ]);

  const metrics: WeeklyMetricsDto = {
    kindness: average(feedbackScores.map((f) => f.kindness_score)),
    initiative: average(feedbackScores.map((f) => f.initiative_score)),
    empathy: average(feedbackScores.map((f) => f.empathy_score)),
    questionLink: average(feedbackScores.map((f) => f.question_link_score)),
  };

  return { completedMissionCount, xpEarned, metrics };
};

const changeRate = (from: number, to: number): number => {
  if (from === 0) return 0;
  return Math.round(((to - from) / from) * 1000) / 10;
};

const overallScore = (metrics: WeeklyMetricsDto): number =>
  average([metrics.kindness, metrics.initiative, metrics.empathy, metrics.questionLink]);

// 이번 주(월요일 시작)의 시작점. report.service.ts의 스냅샷 저장(period/title)도 반드시 이 함수를
// 같이 써야 GET과 POST /reports가 같은 기준으로 계산된다.
export const getThisWeekStart = (now: Date): Date => getWeekStart(now);

export const calculateWeeklyCompare = async (userId: string): Promise<WeeklyCompareReportDto> => {
  const now = new Date();
  const thisWeekStart = getWeekStart(now);
  const thisWeekEnd = addDays(thisWeekStart, 7);
  const lastWeekStart = addDays(thisWeekStart, -7);

  const [thisWeek, lastWeek] = await Promise.all([
    getWeekActivity(userId, thisWeekStart, thisWeekEnd),
    getWeekActivity(userId, lastWeekStart, thisWeekStart),
  ]);

  const fromScore = overallScore(lastWeek.metrics);
  const toScore = overallScore(thisWeek.metrics);

  const metricChanges: MetricChangeDto[] = METRIC_DEFS.map(({ key, label }) => ({
    key,
    label,
    from: lastWeek.metrics[key],
    to: thisWeek.metrics[key],
    delta: thisWeek.metrics[key] - lastWeek.metrics[key],
  }));

  const highlights: string[] = [];
  if (toScore !== fromScore) {
    highlights.push(`전체 점수가 ${fromScore}점에서 ${toScore}점으로 ${toScore > fromScore ? "상승" : "하락"}했어요`);
  }
  const biggestChanges = [...metricChanges]
    .filter((m) => m.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 2);
  for (const change of biggestChanges) {
    highlights.push(`${withSubjectParticle(change.label)} 가장 많이 ${change.delta > 0 ? "상승" : "하락"}했어요`);
  }

  return {
    thisWeek,
    lastWeek,
    xpChangeRate: changeRate(lastWeek.xpEarned, thisWeek.xpEarned),
    overallScoreChange: { from: fromScore, to: toScore, delta: toScore - fromScore },
    metricChanges,
    highlights: highlights.slice(0, 3),
  };
};
