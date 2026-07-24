import { SubscriptionStatus } from "@prisma/client";
import { prisma } from "../../../config/database";

export const findLatestSubscriptionByUserId = (userId: string) =>
  prisma.subscriptions.findFirst({
    where: { user_id: userId },
    orderBy: { created_at: "desc" },
    include: { plan: true },
  });

export const findSubscriptionByIdAndUserId = (id: string, userId: string) =>
  prisma.subscriptions.findFirst({ where: { id, user_id: userId } });

export const createSubscription = (params: { userId: string; planId: string }) =>
  prisma.subscriptions.create({
    data: {
      user_id: params.userId,
      plan_id: params.planId,
      status: "pending",
      started_at: new Date(),
    },
  });

export const updateSubscriptionStatus = (id: string, status: SubscriptionStatus) =>
  prisma.subscriptions.update({ where: { id }, data: { status } });

// 결제 성공 시 pending -> active로 전환하며, 실제 이용 시작 시점을 started_at으로 갱신한다.
export const activateSubscription = (id: string, expiresAt: Date) =>
  prisma.subscriptions.update({
    where: { id },
    data: { status: "active", started_at: new Date(), expires_at: expiresAt },
  });
