import { z } from "zod";
import { passwordSchema } from "../../auth/dtos/email-auth.dto";

export interface VerifyPasswordRequestDto {
  currentPassword: string;
}

export const verifyPasswordRequestSchema = z.object({
  currentPassword: z.string().min(1, "현재 비밀번호가 필요합니다"),
}) satisfies z.ZodType<VerifyPasswordRequestDto>;

export interface ChangePasswordRequestDto {
  newPassword: string;
}

export const changePasswordRequestSchema = z.object({
  newPassword: passwordSchema,
}) satisfies z.ZodType<ChangePasswordRequestDto>;
