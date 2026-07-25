import { Prisma } from "@prisma/client";
import { prisma } from "../../../config/database";
import { logger } from "../../../config/logger";
import * as conditionRepository from "../repositories/badge-condition.repository";
import { BadgeCondition, BadgeProgressDto } from "../dtos/badge-condition.dto";

// 절대 만족되지 않는 안전한 기본값. condition이 비어있거나(레거시로 수동 삽입된 뱃지 등)
// 알 수 없는 type이면 여기로 빠진다 — 판정 로직 자체가 죽어서 배지 목록 API 전체가 500 나는 것보다,
// 그 뱃지 하나만 "절대 못 딴다" 취급하고 넘어가는 게 안전하다.
const UNSATISFIABLE_PROGRESS: BadgeProgressDto = { current: 0, target: 1 };

type TxClient = Prisma.TransactionClient;

const DAY_MS = 24 * 60 * 60 * 1000;

// 오늘부터 거슬러 올라가며 하루도 안 빠진 최장 연속일 수를 센다.
// 스트릭은 "한 번이라도 target에 도달한 적 있으면 계속 뱃지 보유"가 일반적인 관례라,
// 배지 여부 판정은 이 값이 target 이상인지로 하고 끊긴 이후엔 다시 낮아져도 이미 딴 뱃지는 유지된다
// (User_Badges에 한 번 insert되면 재판정 대상에서 제외되기 때문에 자동으로 보장됨).
const calculateCurrentStreak = (completedDays: Date[]): number => {
  if (completedDays.length === 0) return 0;

  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const mostRecent = completedDays[0].getTime();

  // 오늘 또는 어제까지는 완료 기록이 있어야 "현재 진행 중인 스트릭"으로 본다.
  if (todayUtc - mostRecent > DAY_MS) return 0;

  let streak = 1;
  let cursor = mostRecent;
  for (let i = 1; i < completedDays.length; i++) {
    const next = completedDays[i].getTime();
    if (cursor - next === DAY_MS) {
      streak += 1;
      cursor = next;
    } else {
      break;
    }
  }
  return streak;
};

const KNOWN_CONDITION_TYPES = new Set<BadgeCondition["type"]>([
  "mission_complete_count",
  "mission_complete_count_by_categories",
  "distinct_mission_category_count",
  "mission_streak_days",
  "feedback_metric_threshold_count",
  "feedback_all_metrics_threshold_count",
  "feedback_created_count",
]);

export const getBadgeProgress = async (
  db: typeof prisma | TxClient,
  userId: string,
  condition: BadgeCondition
): Promise<BadgeProgressDto> => {
  if (!condition || !KNOWN_CONDITION_TYPES.has(condition.type)) {
    logger.warn({ condition }, "알 수 없는 뱃지 condition — 판정 불가로 처리");
    return UNSATISFIABLE_PROGRESS;
  }

  switch (condition.type) {
    case "mission_complete_count": {
      const current = await conditionRepository.countCompletedMissions(db, userId);
      return { current, target: condition.target };
    }
    case "mission_complete_count_by_categories": {
      const current = await conditionRepository.countCompletedMissionsByCategories(
        db,
        userId,
        condition.categories
      );
      return { current, target: condition.target };
    }
    case "distinct_mission_category_count": {
      const current = await conditionRepository.countDistinctCompletedCategories(db, userId);
      return { current, target: condition.target };
    }
    case "mission_streak_days": {
      const days = await conditionRepository.findCompletedMissionDates(db, userId);
      const current = calculateCurrentStreak(days);
      return { current, target: condition.target };
    }
    case "feedback_metric_threshold_count": {
      const current = await conditionRepository.countFeedbacksByMetricThreshold(
        db,
        userId,
        condition.metric,
        condition.threshold
      );
      return { current, target: condition.target };
    }
    case "feedback_all_metrics_threshold_count": {
      const current = await conditionRepository.countFeedbacksAllMetricsThreshold(
        db,
        userId,
        condition.threshold
      );
      return { current, target: condition.target };
    }
    case "feedback_created_count": {
      const current = await conditionRepository.countCreatedFeedbacks(db, userId);
      return { current, target: condition.target };
    }
  }
};

export const isSatisfied = (progress: BadgeProgressDto): boolean => progress.current >= progress.target;
