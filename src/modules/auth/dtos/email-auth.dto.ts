import { z } from "zod";

// design.md `### Auth APIs` > /auth/email/request, /auth/email/verify, /auth/signup, /auth/login 참고.
// CONVENTION.md `## 3.9` 비밀번호 규칙: 8자 이상, 숫자/영문/특수문자 각 1개 이상 포함.
const passwordSchema = z
  .string()
  .min(8, "비밀번호는 8자 이상이어야 합니다")
  .regex(/[0-9]/, "비밀번호에 숫자를 포함해야 합니다")
  .regex(/[a-zA-Z]/, "비밀번호에 영문을 포함해야 합니다")
  .regex(/[^0-9a-zA-Z]/, "비밀번호에 특수문자를 포함해야 합니다");

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
  birthDate: string;
  schoolOrJob: string;
  termsAgreed: boolean;
}

export const signupRequestSchema = z.object({
  email: z.string().email("올바른 이메일 형식이 아닙니다"),
  password: passwordSchema,
  name: z.string().min(1, "이름이 필요합니다").max(50),
  birthDate: z.string().min(1, "생년월일이 필요합니다"),
  schoolOrJob: z.string().min(1, "학교/직업이 필요합니다").max(100),
  termsAgreed: z.boolean(),
}) satisfies z.ZodType<SignupRequestDto>;

export interface LoginRequestDto {
  email: string;
  password: string;
}

export const loginRequestSchema = z.object({
  email: z.string().email("올바른 이메일 형식이 아닙니다"),
  password: z.string().min(1, "비밀번호가 필요합니다"),
}) satisfies z.ZodType<LoginRequestDto>;

export interface EmailAuthUserDto {
  id: string;
  email: string;
  provider: "email";
}

export interface EmailAuthResponseDto {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: EmailAuthUserDto;
}
