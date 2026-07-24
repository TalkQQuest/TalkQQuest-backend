import { Prisma } from "@prisma/client";
import { prisma } from "../../../config/database";
import * as badgeRepository from "../repositories/badge.repository";
import { getBadgeProgress, isSatisfied } from "./badge-condition.service";
import { BadgeCondition } from "../dtos/badge-condition.dto";
import { BadgeItemDto, BadgeListResponseDto, NewlyEarnedBadgeDto } from "../dtos/badge.dto";

type TxClient = Prisma.TransactionClient;

// 미획득 뱃지 중 조건을 만족한 것을 판정해 User_Badges에 적립하고, 이번에 새로 획득한 것만 반환한다.
// 크론 없이 두 지점에서 호출된다:
//  - 미션 완료 트랜잭션 안 (tx로 호출) — 완료 응답에 실어 즉시 축하 모달용으로 전달
//  - GET /badges/me 조회 시점 (prisma로 호출) — 피드백 기반 뱃지처럼 완료 시점에 걸리지 않는 것들을 여기서 채운다
// User_Badges.[user_id, badge_id] unique 제약이 동시 호출 시 중복 획득을 막아준다.
export const checkAndAwardBadges = async (
  db: typeof prisma | TxClient,
  userId: string
): Promise<NewlyEarnedBadgeDto[]> => {
  const [allBadges, earnedIds] = await Promise.all([
    badgeRepository.findAllBadges(db),
    badgeRepository.findEarnedBadgeIds(db, userId),
  ]);

  const newlyEarned: NewlyEarnedBadgeDto[] = [];

  for (const badge of allBadges) {
    if (earnedIds.has(badge.id)) continue;

    const condition = badge.condition as unknown as BadgeCondition;
    const progress = await getBadgeProgress(db, userId, condition);
    if (!isSatisfied(progress)) continue;

    const created = await badgeRepository.createUserBadge(db, userId, badge.id);
    newlyEarned.push({
      id: badge.id,
      name: badge.name,
      description: badge.description,
      iconUrl: badge.icon_url,
      earnedAt: created.earned_at.toISOString(),
    });
  }

  return newlyEarned;
};

export const getMyBadges = async (userId: string): Promise<BadgeListResponseDto> => {
  // 조회 시점에 조건이 충족된 게 있으면 그 자리에서 획득 처리한다. 피드백 기반 뱃지는
  // 미션 완료 트랜잭션 밖(POST /feedback)에서 조건이 채워지므로, 여기서 지연 계산으로 잡아준다.
  await checkAndAwardBadges(prisma, userId);

  const [allBadges, userBadges] = await Promise.all([
    badgeRepository.findAllBadges(),
    badgeRepository.findUserBadgesByUserId(userId),
  ]);
  const earnedByBadgeId = new Map(userBadges.map((ub) => [ub.badge_id, ub]));

  const badges: BadgeItemDto[] = await Promise.all(
    allBadges.map(async (badge) => {
      const earned = earnedByBadgeId.get(badge.id);
      if (earned) {
        return {
          id: badge.id,
          name: badge.name,
          description: badge.description,
          iconUrl: badge.icon_url,
          isEarned: true,
          earnedAt: earned.earned_at.toISOString(),
          progress: null,
        };
      }

      const condition = badge.condition as unknown as BadgeCondition;
      const progress = await getBadgeProgress(prisma, userId, condition);
      return {
        id: badge.id,
        name: badge.name,
        description: badge.description,
        iconUrl: badge.icon_url,
        isEarned: false,
        earnedAt: null,
        progress,
      };
    })
  );

  return { badges };
};
