import { prisma } from "../../../config/database";

export const createPayment = (params: {
  userId: string;
  subscriptionId: string;
  amount: number;
  currency: string;
  method: string;
  externalId: string;
}) =>
  prisma.payments.create({
    data: {
      user_id: params.userId,
      subscription_id: params.subscriptionId,
      amount: params.amount,
      currency: params.currency,
      method: params.method,
      external_id: params.externalId,
      status: "completed",
      completed_at: new Date(),
    },
  });

export const findPaymentsByUserId = (userId: string) =>
  prisma.payments.findMany({
    where: { user_id: userId },
    orderBy: { created_at: "desc" },
  });
