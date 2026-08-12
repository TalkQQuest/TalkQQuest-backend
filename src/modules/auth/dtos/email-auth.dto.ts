import { z } from "zod";

// design.md `### Auth APIs` > /auth/email/request, /auth/email/verify, /auth/signup, /auth/login 참고.
// CONVENTION.md `## 3.9` 비밀번호 규칙: 8~16자, 숫자/영문 각 1개 이상 포함(#181 — 특수문자 필수 조건 제거,
// 화면(Figma)에 특수문자 조건이 없어 서버 검증만 더 엄격했던 불일치를 해소).
export const passwordSchema = z
  .string()
  .min(8, "비밀번호는 8자 이상이어야 합니다")
  .max(16, "비밀번호는 16자 이하여야 합니다")
  .regex(/[0-9]/, "비밀번호에 숫자를 포함해야 합니다")
  .regex(/[a-zA-Z]/, "비밀번호에 영문을 포함해야 합니다");

export interface EmailRequestDto {
  email: string;
}

export const emailRequestSchema = z.object({
  email: z.string().email("올바른 이메일 형식이 아닙니다"),
}) satisfies z.ZodType<EmailRequestDto>;

export interface EmailVerifyDto {
  email: string;
  code: string;
}

export const emailVerifySchema = z.object({
  email: z.string().email("올바른 이메일 형식이 아닙니다"),
  code: z.string().min(1, "인증번호가 필요합니다"),
}) satisfies z.ZodType<EmailVerifyDto>;

export interface SignupRequestDto {
  email: string;
  password: string;
  name: string;
  termsAgreedAt: string;
}

export const signupRequestSchema = z.object({
  email: z.string().email("올바른 이메일 형식이 아닙니다"),
  password: passwordSchema,
  name: z.string().min(1, "이름이 필요합니다").max(50),
  termsAgreedAt: z.string().datetime({ message: "termsAgreedAt은 ISO 8601 형식이어야 합니다" }),
}) satisfies z.ZodType<SignupRequestDto>;

export interface LoginRequestDto {
  email: string;
  password: string;
}

export const loginRequestSchema = z.object({
  email: z.string().email("올바른 이메일 형식이 아닙니다"),
  password: z.string().min(1, "비밀번호가 필요합니다"),
}) satisfies z.ZodType<LoginRequestDto>;

export interface SignupResponseDto {
  userId: string;
  accessToken: string;
  refreshToken: string;
}

export interface LoginResponseDto {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
}
