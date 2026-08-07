import { Prisma } from "@prisma/client";
import { logger } from "../../../config/logger";
import { withSubjectParticle } from "../../../shared/utils/korean";
import * as reportRepository from "../repositories/report.repository";
import { MetricChangeDto, WeeklyActivityDto, WeeklyCompareReportDto, WeeklyMetricsDto } from "../dtos/report.dto";
import { getCompletedWeekCount, getSignupWeekRange } from "./week-window";

// #145 — 주간 비교 리포트. "지금 이 순간까지의 이번 주"가 아니라 가입일 기준으로 완전히 끝난
// 주끼리만 비교한다. 대화 완료(피드백 생성) 시점마다 generateMissingWeeklyReports를 호출해
// 지연 계산으로 생성한다(스케줄러 없음). 활동이 있던 주만 리포트를 만들고, 비교 대상은
// 바로 직전 주가 아니라 "가장 최근에 리포트가 생성된 주"다 — 몇 주를 건너뛰어도 체인이
// 자연스럽게 이어진다(예: 1주차 이후 2·3주차에 활동이 없었다면 1주차→4주차로 바로 비교).
//
// 미션 리마인드 기능을 위해 스케줄러 인프라가 생기면, 이 파일의 generateMissingWeeklyReports를
// "대화 완료 시점" 대신 스케줄러가 매일 전체 유저를 순회하며 호출하는 방식으로 옮기는 것이
// 맞다. 그 전환이 호출부만 바꾸면 끝나도록, 이 함수는 트리거 방식과 무관하게 순수하게
// "이 유저에게 새로 만들 리포트가 있으면 만든다"만 담당한다.

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

const ZERO_ACTIVITY: WeeklyActivityDto = {
  completedMissionCount: 0,
  xpEarned: 0,
  metrics: { kindness: 0, initiative: 0, empathy: 0, questionLink: 0 },
};

// 이 구간에 실제 피드백이 있었는지까지 함께 돌려준다 — 활동 없는 주는 리포트를 만들지 않기
// 위한 판단 기준이다(평균 함수만 보면 피드백이 없어도 0을 돌려줘 구분이 안 된다).
const getWeekActivity = async (
  userId: string,
  start: Date,
  end: Date
): Promise<{ activity: WeeklyActivityDto; hasActivity: boolean }> => {
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

  return {
    activity: { completedMissionCount, xpEarned, metrics },
    hasActivity: feedbackScores.length > 0,
  };
};

const changeRate = (from: number, to: number): number => {
  if (from === 0) return 0;
  return Math.round(((to - from) / from) * 1000) / 10;
};

const overallScore = (metrics: WeeklyMetricsDto): number =>
  average([metrics.kindness, metrics.initiative, metrics.empathy, metrics.questionLink]);

const buildCompareDto = (lastWeek: WeeklyActivityDto, thisWeek: WeeklyActivityDto): WeeklyCompareReportDto => {
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

export interface GeneratedWeeklyReport {
  id: string;
  weekIndex: number;
  data: WeeklyCompareReportDto;
}

// 한 번 호출에서 순차로 조회할 주차 수 상한. 오랫동안 미접속했다 돌아온 유저는 밀린 주차가
// 많을 수 있는데, 주차별 조회가 루프 안에서 순차 실행되므로 상한 없이 전부 처리하면 호출 하나가
// 매우 오래 걸릴 수 있다. 상한을 넘는 나머지는 이번 호출에서 만들지 않고 다음 트리거(다음 대화
// 완료) 때 이어서 처리한다 — 건너뛴 빈 주차는 저장되지 않으므로 다시 스캔해도 안전하다(멱등).
const MAX_WEEKS_PER_CALL = 8;

// 가입 이후 새로 완결된 주차들을 확인해, 활동이 있던 주만 순서대로 리포트를 생성한다.
// 활동 없는 주는 건너뛰고(리포트 미생성), 다음 활동 있는 주가 나오면 "가장 최근 리포트"와 비교한다.
export const generateMissingWeeklyReports = async (
  userId: string,
  signupAt: Date
): Promise<GeneratedWeeklyReport[]> => {
  const completedWeeks = getCompletedWeekCount(signupAt, new Date());
  if (completedWeeks < 1) return [];

  const latest = await reportRepository.findLatestWeeklyCompareReport(userId);
  const lastGeneratedWeekIndex = latest?.week_index ?? 0;
  if (lastGeneratedWeekIndex >= completedWeeks) return [];

  // 비교 기준(lastWeek)은 가장 최근 리포트의 thisWeek다. 리포트가 하나도 없었다면
  // 가입 직후 상태(전부 0)를 기준으로 첫 리포트를 만든다.
  let carryForward: WeeklyActivityDto = latest
    ? (latest.data as unknown as WeeklyCompareReportDto).thisWeek
    : ZERO_ACTIVITY;

  const created: GeneratedWeeklyReport[] = [];
  const targetWeek = Math.min(completedWeeks, lastGeneratedWeekIndex + MAX_WEEKS_PER_CALL);

  for (let weekIndex = lastGeneratedWeekIndex + 1; weekIndex <= targetWeek; weekIndex += 1) {
    const { start, end } = getSignupWeekRange(signupAt, weekIndex);
    const { activity, hasActivity } = await getWeekActivity(userId, start, end);

    if (!hasActivity) continue; // 활동 없는 주는 리포트를 만들지 않는다.

    const data = buildCompareDto(carryForward, activity);

    try {
      const row = await reportRepository.createWeeklyCompareReport(userId, weekIndex, data);
      created.push({ id: row.id, weekIndex, data });
      carryForward = activity;
    } catch (error) {
      // P2002 = unique(user_id, week_index) 위반. 동시에 여러 대화가 끝나 같은 주차를
      // 두 번 만들려 한 경우인데, 이미 누군가 만들었다는 뜻이므로 그 결과를 그대로 받아들인다.
      //
      // 진 요청이 carryForward를 안 갱신한 채로 다음 주차를 계산하면, 한 호출에서 여러 주차를
      // 한꺼번에 따라잡는 경우(오랜만에 대화 재개) 다음 주차의 from 값이 이 주차의 실제 결과가
      // 아니라 그보다 더 예전 값으로 잘못 저장된다. 승자가 실제로 뭘 저장했는지 다시 읽어서
      // carryForward를 맞춰야 한다(mission.service.ts의 createMissionForRecommendationLog와
      // 같은 이유로, 승자 값을 반드시 다시 조회해서 가져온다).
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        logger.warn({ userId, weekIndex }, "주간 비교 리포트 동시 생성 경합 — 승자 값으로 이어감");
        const winner = await reportRepository.findWeeklyCompareReportByWeekIndex(userId, weekIndex);
        if (winner) {
          carryForward = (winner.data as unknown as WeeklyCompareReportDto).thisWeek;
        }
        continue;
      }
      throw error;
    }
  }

  return created;
};
