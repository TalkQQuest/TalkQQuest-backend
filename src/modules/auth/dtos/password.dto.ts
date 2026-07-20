import { z } from "zod";
import { passwordSchema } from "./email-auth.dto";

export interface PasswordResetRequestDto {
  email: string;
}

export const passwordResetRequestSchema = z.object({
  email: z.string().email("올바른 이메일 형식이 아닙니다"),
}) satisfies z.ZodType<PasswordResetRequestDto>;

export interface PasswordResetDto {
  email: string;
  code: string;
  newPassword: string;
}

export const passwordResetSchema = z.object({
  email: z.string().email("올바른 이메일 형식이 아닙니다"),
  code: z.string().min(1, "인증번호가 필요합니다"),
  newPassword: passwordSchema,
}) satisfies z.ZodType<PasswordResetDto>;
