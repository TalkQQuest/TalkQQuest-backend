import { createPayment, findPaymentsByUserId } from "../repositories/payment.repository";
import { findSubscriptionByIdAndUserId } from "../repositories/subscription.repository";
import { InvalidPaymentError } from "../errors/payment.error";
import { CreatePaymentRequestDto, CreatePaymentResponseDto, PaymentListResponseDto } from "../dtos/payment.dto";
import { activateSubscriptionAfterPayment } from "./subscription.service";

// 사업자등록증이 없어 실제 PG(결제대행사) 연동이 불가능하다. 클라이언트가 보낸 결제 정보를
// 검증 없이 그대로 신뢰하고 즉시 completed로 기록하는 mock 구현이다.
// 결제 대상 구독은 반드시 'pending'(POST /subscriptions로 막 생성된, 아직 활성화 전) 상태여야 하며,
// 결제가 성공해야 비로소 구독이 active로 활성화된다 — "구독하기"만으로는 프리미엄이 되지 않는다.
export const requestPayment = async (
  userId: string,
  request: CreatePaymentRequestDto
): Promise<CreatePaymentResponseDto> => {
  const subscription = await findSubscriptionByIdAndUserId(request.subscriptionId, userId);
  if (!subscription || subscription.status !== "pending") {
    throw new InvalidPaymentError();
  }

  const payment = await createPayment({
    userId,
    subscriptionId: subscription.id,
    amount: request.amount,
    currency: request.currency ?? "KRW",
    method: request.method,
    externalId: request.externalId,
  });

  await activateSubscriptionAfterPayment(subscription.id);

  return {
    paymentId: payment.id,
    status: payment.status,
    completedAt: payment.completed_at!.toISOString(),
  };
};

export const getMyPayments = async (userId: string): Promise<PaymentListResponseDto> => {
  const payments = await findPaymentsByUserId(userId);

  return {
    payments: payments.map((payment) => ({
      id: payment.id,
      amount: Number(payment.amount),
      currency: payment.currency,
      method: payment.method,
      status: payment.status,
      createdAt: payment.created_at.toISOString(),
      completedAt: payment.completed_at?.toISOString() ?? null,
    })),
  };
};
