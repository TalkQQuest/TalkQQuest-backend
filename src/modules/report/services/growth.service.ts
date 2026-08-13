import { calculateNextLevelXp } from "../../xp/services/level.service";
import * as reportRepository from "../repositories/report.repository";
import * as missionRepository from "../../mission/repositories/mission.repository";
import { GrowthReportDto, TopCategoryDto, WeeklyTrendPointDto } from "../dtos/report.dto";
import { addDays, getWeekStart } from "./week-window";

const WEEKS_IN_WINDOW = 4;

const getWeekLabel = (date: Date): string => {
  const month = date.getUTCMonth() + 1;
  const weekOfMonth = Math.ceil(date.getUTCDate() / 7);
  return `${month}월 ${weekOfMonth}주`;
};

const average = (scores: (number | null)[]): number => {
  const valid = scores.filter((score): score is number => score !== null);
  if (valid.length === 0) return 0;
  return Math.round(valid.reduce((sum, score) => sum + score, 0) / valid.length);
};

// User_Profiles.xp는 "현재 레벨 내 진행도"라 누적값이 아니다. 특정 시점의 레벨을 알려면
// XP_History를 시간순으로 재생하며 mission-completion.service.ts와 동일한 레벨업 공식을 적용해야 한다.
const reconstructLevelAt = (
  xpHistory: { amount: number; created_at: Date }[],
  cutoff: Date
): number => {
  let level = 1;
  let xp = 0;
  let threshold = calculateNextLevelXp(level);

  for (const entry of xpHistory) {
    if (entry.created_at >= cutoff) break;
    xp += entry.amount;
    while (xp >= threshold) {
      xp -= threshold;
      level += 1;
      threshold = calculateNextLevelXp(level);
    }
  }
  return level;
};

// 이번 주(월요일 시작) 포함 최근 4주 구간의 시작점. report.service.ts의 저장(period/title) 로직도
// 반드시 이 함수를 같이 써야 GET과 POST /reports(스냅샷)가 같은 기준으로 계산된다.
export const getGrowthWindowStart = (now: Date): Date => addDays(getWeekStart(now), -7 * (WEEKS_IN_WINDOW - 1));

export const getGrowthReport = async (userId: string): Promise<GrowthReportDto> => {
  const now = new Date();
  const currentWeekStart = getWeekStart(now);
  const windowStart = getGrowthWindowStart(now);

  // missionProgress.total은 GET /missions와 같은 공개 범위(visibility) 기준으로 세야 한다(#201).
  const personalityType = await missionRepository.findUserPersonalityType(userId);
  const visibility = { userId, personalityType };

  const [
    profile,
    xpHistory,
    feedbackScores,
    missionCategories,
    totalMissions,
    completedMissions,
    growthTotals,
  ] = await Promise.all([
    reportRepository.findProfileByUserId(userId),
    reportRepository.findXpHistoryAscByUserId(userId),
    reportRepository.findFeedbackScoresInRange(userId, windowStart, now),
    reportRepository.findCompletedMissionCategoriesInRange(userId, windowStart, now),
    reportRepository.countTotalMissions(visibility),
    reportRepository.countDistinctCompletedMissions(userId),
    reportRepository.sumFeedbackMetricTotals(userId),
  ]);

  const levelAfter = profile?.level ?? 1;
  const levelBefore = reconstructLevelAt(xpHistory, windowStart);

  // 4주 버킷은 반드시 "이번 주(월요일 시작)"를 기준으로 고정한다. now로부터 rolling 7일씩 계산하면
  // 같은 주 안에서도 호출 시각에 따라 버킷 경계가 밀려 값이 흔들린다.
  const weeklyTrend: WeeklyTrendPointDto[] = [];
  for (let i = WEEKS_IN_WINDOW - 1; i >= 0; i--) {
    const bucketStart = addDays(currentWeekStart, -7 * i);
    const bucketEnd = addDays(bucketStart, 7);
    const scoresInBucket = feedbackScores
      .filter((f) => f.created_at >= bucketStart && f.created_at < bucketEnd)
      .map((f) =>
        average([f.kindness_score, f.initiative_score, f.empathy_score, f.question_link_score])
      );
    weeklyTrend.push({
      week: getWeekLabel(bucketStart),
      score: scoresInBucket.length === 0 ? 0 : average(scoresInBucket),
    });
  }

  const firstScore = weeklyTrend[0]?.score ?? 0;
  const lastScore = weeklyTrend[weeklyTrend.length - 1]?.score ?? 0;
  const trendChangeRate = firstScore === 0 ? 0 : Math.round(((lastScore - firstScore) / firstScore) * 1000) / 10;

  const categoryCounts = new Map<string, number>();
  for (const record of missionCategories) {
    const category = record.mission.category;
    categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
  }
  const topCategories: TopCategoryDto[] = [...categoryCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([category, count]) => ({ category, count }));

  return {
    levelBefore,
    levelAfter,
    weeklyTrend,
    trendChangeRate,
    topCategories,
    missionProgress: { completed: completedMissions, total: totalMissions },
    growthTotals,
  };
};

// #145 — 홈 화면 등 성장 리포트 화면 밖에서도 티어 표시를 위해 누적값만 가볍게 필요할 때 쓴다.
// getGrowthReport 전체를 계산하지 않고 SUM 하나만 돌린다.
export const getGrowthMetricTotals = (userId: string) => reportRepository.sumFeedbackMetricTotals(userId);
