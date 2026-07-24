import bcrypt from "bcrypt";
import { redis } from "../../../config/redis";
import {
  EmailNotFoundError,
  InvalidPasswordError,
  InvalidVerificationCodeError,
  PasswordNotVerifiedError,
  VerificationCodeExpiredError,
} from "../errors/auth.error";
import {
  findEmailIdentityByUserId,
  findIdentityByProviderAndEmail,
  revokeRefreshTokensByUserId,
  updatePasswordHashByUserId,
} from "../repositories/auth.repository";
import { sendPasswordResetEmail } from "./mail.service";

const BCRYPT_SALT_ROUNDS = 10;

// 비밀번호 찾기(재설정) — email-verification.service.ts와 동일한 Redis 코드 발급/검증 패턴이되,
// 회원가입 인증 코드와 네임스페이스가 섞이지 않도록 키 프리픽스를 분리한다.
const RESET_CODE_TTL_SECONDS = 5 * 60;
const resetCodeKey = (email: string) => `password-reset:code:${email}`;

// 비밀번호 변경(로그인 상태) — 현재 비밀번호 확인 후 짧은 유예 시간 동안만 실제 변경을 허용한다.
// (화면이 "현재 비밀번호 확인 → 새 비밀번호 입력" 2단계로 구성되어, 확인 단계를 건너뛰고
// 변경 API를 바로 호출하는 것을 막기 위함 — email-verification.service.ts의 verifiedKey와 동일한 목적.)
const PASSWORD_VERIFIED_TTL_SECONDS = 10 * 60;
const passwordVerifiedKey = (userId: string) => `password-change:verified:${userId}`;

const generateCode = () => String(Math.floor(100000 + Math.random() * 900000));

export const requestPasswordReset = async (email: string): Promise<void> => {
  const identity = await findIdentityByProviderAndEmail("email", email);
  if (!identity || !identity.password_hash) {
    throw new EmailNotFoundError();
  }

  const code = generateCode();
  await redis.set(resetCodeKey(email), code, "EX", RESET_CODE_TTL_SECONDS);
  await sendPasswordResetEmail(email, code);
};

export const resetPassword = async (
  email: string,
  code: string,
  newPassword: string
): Promise<void> => {
  const identity = await findIdentityByProviderAndEmail("email", email);
  if (!identity || !identity.password_hash) {
    throw new EmailNotFoundError();
  }

  const savedCode = await redis.get(resetCodeKey(email));
  if (!savedCode) {
    throw new VerificationCodeExpiredError();
  }
  if (savedCode !== code) {
    throw new InvalidVerificationCodeError();
  }
  await redis.del(resetCodeKey(email));

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);
  await updatePasswordHashByUserId(identity.user_id, passwordHash);
  // 비밀번호가 바뀌었으니 기존에 발급된 세션은 전부 무효화한다.
  await revokeRefreshTokensByUserId(identity.user_id);
};

export const verifyCurrentPassword = async (userId: string, currentPassword: string): Promise<void> => {
  const identity = await findEmailIdentityByUserId(userId);
  if (!identity || !identity.password_hash) {
    throw new EmailNotFoundError();
  }

  const matches = await bcrypt.compare(currentPassword, identity.password_hash);
  if (!matches) {
    throw new InvalidPasswordError();
  }

  await redis.set(passwordVerifiedKey(userId), "1", "EX", PASSWORD_VERIFIED_TTL_SECONDS);
};

export const changePassword = async (userId: string, newPassword: string): Promise<void> => {
  const verified = await redis.get(passwordVerifiedKey(userId));
  if (!verified) {
    throw new PasswordNotVerifiedError();
  }

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);
  await updatePasswordHashByUserId(userId, passwordHash);
  await redis.del(passwordVerifiedKey(userId));
  // 비밀번호가 바뀌었으니 기존에 발급된 세션은 전부 무효화한다.
  await revokeRefreshTokensByUserId(userId);
};
