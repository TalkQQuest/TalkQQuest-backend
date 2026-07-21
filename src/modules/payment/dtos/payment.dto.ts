import { z } from "zod";

export interface CreatePaymentRequestDto {
  subscriptionId: string;
  amount: number;
  currency?: string;
  method: string;
  externalId: string;
}

export const createPaymentRequestSchema = z.object({
  subscriptionId: z.string().min(1, "subscriptionId가 필요합니다"),
  amount: z.number().positive("amount는 0보다 커야 합니다"),
  currency: z.string().length(3).optional(),
  method: z.string().min(1, "method가 필요합니다"),
  externalId: z.string().min(1, "externalId가 필요합니다"),
}) satisfies z.ZodType<CreatePaymentRequestDto>;

export interface CreatePaymentResponseDto {
  paymentId: string;
  status: string;
  completedAt: string;
}

export interface PaymentItemDto {
  id: string;
  amount: number;
  currency: string;
  method: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
}

export interface PaymentListResponseDto {
  payments: PaymentItemDto[];
}
