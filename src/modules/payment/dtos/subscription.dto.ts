import { z } from "zod";

export interface CreateSubscriptionRequestDto {
  planId: string;
}

export const createSubscriptionRequestSchema = z.object({
  planId: z.string().min(1, "planId가 필요합니다"),
}) satisfies z.ZodType<CreateSubscriptionRequestDto>;

export interface CreateSubscriptionResponseDto {
  subscriptionId: string;
  status: string;
  expiresAt: string | null;
}

export interface MySubscriptionResponseDto {
  subscriptionId: string;
  planName: string;
  status: string;
  startedAt: string;
  expiresAt: string | null;
}
