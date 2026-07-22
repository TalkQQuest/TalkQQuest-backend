import { Subscriptions } from "@prisma/client";
import {
  activateSubscription,
  createSubscription,
  findLatestSubscriptionByUserId,
  updateSubscriptionStatus,
} from "../repositories/subscription.repository";
import { findPlanById } from "../repositories/plan.repository";
import {
  ActiveSubscriptionExistsError,
  InvalidPlanError,
  NoActiveSubscriptionError,
} from "../errors/payment.error";
import { CreateSubscriptionRequestDto, CreateSubscriptionResponseDto, MySubscriptionResponseDto } from "../dtos/subscription.dto";

// 배치/크론 없이, 조회 시점마다 만료 여부를 계산한다 (lazy evaluation).
// status가 DB에 'active'/'cancelled'로 남아있어도 expires_at이 지났으면 더 이상 유효하지 않다.
// 'pending'(결제 대기 중)은 애초에 유효한 구독이 아니다.
// 다른 모듈(예: 사용량 조회)에서도 "지금 이 구독이 유효한가"를 판단할 때 이 함수를 재사용한다.
export const isSubscriptionEffective = (subscription: Pick<Subscriptions, "status" | "expires_at">): boolean => {
  if (subscription.status === "pending" || subscription.status === "expired") return false;
  if (!subscription.expires_at) return true;
  return subscription.expires_at.getTime() > Date.now();
};

const addOneMonth = (date: Date): Date => {
  const result = new Date(date);
  result.setMonth(result.getMonth() + 1);
  return result;
};

// 구독은 결제가 성공해야 활성화된다 — POST /subscriptions는 'pending' 상태로만 만들고,
// 실제 활성화(active + expires_at 설정)는 결제 성공 시 payment.service.ts가 이 함수를 호출한다.
export const startSubscription = async (
  userId: string,
  request: CreateSubscriptionRequestDto
): Promise<CreateSubscriptionResponseDto> => {
  const plan = await findPlanById(request.planId);
  if (!plan || !plan.is_active) {
    throw new InvalidPlanError();
  }

  const existing = await findLatestSubscriptionByUserId(userId);
  if (existing && (existing.status === "pending" || isSubscriptionEffective(existing))) {
    throw new ActiveSubscriptionExistsError();
  }

  const subscription = await createSubscription({ userId, planId: plan.id });

  return {
    subscriptionId: subscription.id,
    status: subscription.status,
    expiresAt: null,
  };
};

export const activateSubscriptionAfterPayment = async (subscriptionId: string): Promise<void> => {
  const expiresAt = addOneMonth(new Date());
  await activateSubscription(subscriptionId, expiresAt);
};

export const getMySubscription = async (userId: string): Promise<MySubscriptionResponseDto> => {
  const subscription = await findLatestSubscriptionByUserId(userId);
  if (!subscription || !isSubscriptionEffective(subscription)) {
    throw new NoActiveSubscriptionError();
  }

  return {
    subscriptionId: subscription.id,
    planName: subscription.plan.name,
    status: subscription.status,
    startedAt: subscription.started_at.toISOString(),
    expiresAt: subscription.expires_at?.toISOString() ?? null,
  };
};

export const cancelMySubscription = async (userId: string): Promise<void> => {
  const subscription = await findLatestSubscriptionByUserId(userId);
  if (!subscription || subscription.status !== "active" || !isSubscriptionEffective(subscription)) {
    throw new NoActiveSubscriptionError();
  }

  // expires_at은 그대로 둔다 — 취소해도 이미 결제한 기간(만료 시점)까지는 프리미엄을 유지한다.
  await updateSubscriptionStatus(subscription.id, "cancelled");
};
