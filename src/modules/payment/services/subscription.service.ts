import { Plans, Subscriptions } from "@prisma/client";
import { addMonths } from "../../../shared/utils/date";
import {
  activateSubscription,
  createSubscription,
  findLatestSubscriptionByUserId,
  updateSubscriptionStatus,
} from "../repositories/subscription.repository";
import { findPlanById, findPlanByName } from "../repositories/plan.repository";
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
  const expiresAt = addMonths(new Date(), 1);
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

export interface UsageContext {
  plan: Plans;
  // 사용량 롤링 주기의 기준일. 프리미엄(유효한 active 구독)이면 그 구독의 시작일,
  // 무료면 회원가입일 — 무료 유저는 결제일이 없어 가입일을 대신 기준으로 삼는다.
  cycleAnchor: Date;
}

// 지금 이 유저에게 적용되는 플랜과, 사용량 주기를 계산할 기준일을 함께 반환한다.
// 무료 등급의 실체는 "유효한 active 구독이 없음"이다. 사용량 조회(#59)에서 사용한다.
export const getUsageContext = async (
  userId: string,
  accountCreatedAt: Date
): Promise<UsageContext> => {
  // status==='active'만 인정하면, 취소했지만 아직 만료 전인(cancelled + 유효) 구독을
  // 즉시 무료로 취급해버려 "취소해도 만료일까지 프리미엄 유지"라는 규칙과 모순된다.
  // isSubscriptionEffective 하나로만 판단해 getMySubscription과 기준을 통일한다.
  const subscription = await findLatestSubscriptionByUserId(userId);
  if (subscription && isSubscriptionEffective(subscription)) {
    return { plan: subscription.plan, cycleAnchor: subscription.started_at };
  }

  const freePlan = await findPlanByName("free");
  if (!freePlan) {
    throw new Error("free 플랜이 시드되지 않았습니다. prisma/seed.ts를 확인하세요.");
  }
  return { plan: freePlan, cycleAnchor: accountCreatedAt };
};

export const cancelMySubscription = async (userId: string): Promise<void> => {
  const subscription = await findLatestSubscriptionByUserId(userId);
  if (!subscription || subscription.status !== "active" || !isSubscriptionEffective(subscription)) {
    throw new NoActiveSubscriptionError();
  }

  // expires_at은 그대로 둔다 — 취소해도 이미 결제한 기간(만료 시점)까지는 프리미엄을 유지한다.
  await updateSubscriptionStatus(subscription.id, "cancelled");
};
