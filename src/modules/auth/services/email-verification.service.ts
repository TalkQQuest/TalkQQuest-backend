import { Provider } from "@prisma/client";
import { redis } from "../../../config/redis";
import { DuplicatedError } from "../../../shared/errors/common.error";
import {
  InvalidVerificationCodeError,
  UnverifiedEmailError,
  VerificationCodeExpiredError,
} from "../errors/auth.error";
import { findIdentityByProviderAndEmail } from "../repositories/auth.repository";
import { sendVerificationEmail } from "./mail.service";

// CONVENTION.md `## 3.9` 이메일/비밀번호 로그인 — 회원가입 전 이메일 인증(인증번호 발송/확인) 참고.
const CODE_TTL_SECONDS = 5 * 60; // 인증번호 유효 시간
const VERIFIED_TTL_SECONDS = 30 * 60; // 인증 통과 후 signup까지 유예 시간

const codeKey = (email: string) => `email-verify:code:${email}`;
const verifiedKey = (email: string) => `email-verify:verified:${email}`;

const generateCode = () => String(Math.floor(100000 + Math.random() * 900000));

export const requestEmailVerification = async (email: string): Promise<void> => {
  const providers: Provider[] = ["email", "kakao", "naver"];
  for (const provider of providers) {
    const existing = await findIdentityByProviderAndEmail(provider, email);
    if (existing) {
      throw new DuplicatedError("이미 가입된 이메일입니다");
    }
  }

  const code = generateCode();
  await redis.set(codeKey(email), code, "EX", CODE_TTL_SECONDS);
  await sendVerificationEmail(email, code);
};

export const verifyEmailCode = async (email: string, code: string): Promise<void> => {
  const savedCode = await redis.get(codeKey(email));
  if (!savedCode) {
    throw new VerificationCodeExpiredError();
  }
  if (savedCode !== code) {
    throw new InvalidVerificationCodeError();
  }
  await redis.del(codeKey(email));
  await redis.set(verifiedKey(email), "1", "EX", VERIFIED_TTL_SECONDS);
};

export const assertEmailVerified = async (email: string): Promise<void> => {
  const verified = await redis.get(verifiedKey(email));
  if (!verified) {
    throw new UnverifiedEmailError();
  }
};

export const clearEmailVerified = (email: string) => redis.del(verifiedKey(email));
