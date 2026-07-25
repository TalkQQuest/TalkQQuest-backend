import bcrypt from "bcrypt";
import { Provider } from "@prisma/client";
import {
  createUserWithEmailIdentity,
  findIdentityByProviderAndEmail,
  touchLastLogin,
} from "../repositories/auth.repository";
import { DuplicatedError } from "../../../shared/errors/common.error";
import { EmailNotFoundError, InvalidPasswordError, WithdrawnAccountError } from "../errors/auth.error";
import {
  LoginRequestDto,
  LoginResponseDto,
  SignupRequestDto,
  SignupResponseDto,
} from "../dtos/email-auth.dto";
import { assertEmailVerified, clearEmailVerified } from "./email-verification.service";
import { issueTokens } from "./token.service";

const BCRYPT_SALT_ROUNDS = 10;

// CONVENTION.md `## 3.9` 계정 연동 참고 — 이미 가입된 이메일(수단 무관)이면 새 계정을 만들지 않는다.
export const signupWithEmail = async (request: SignupRequestDto): Promise<SignupResponseDto> => {
  await assertEmailVerified(request.email);

  const providers: Provider[] = ["email", "kakao", "naver"];
  for (const provider of providers) {
    const existing = await findIdentityByProviderAndEmail(provider, request.email);
    if (existing) {
      throw new DuplicatedError("이미 사용 중인 이메일입니다");
    }
  }

  const passwordHash = await bcrypt.hash(request.password, BCRYPT_SALT_ROUNDS);
  const { user, identity } = await createUserWithEmailIdentity({
    email: request.email,
    passwordHash,
    name: request.name,
    termsAgreedAt: new Date(request.termsAgreedAt),
  });
  await clearEmailVerified(request.email);

  const tokens = await issueTokens(user.id, identity.email);
  return { userId: user.id, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
};

export const loginWithEmail = async (request: LoginRequestDto): Promise<LoginResponseDto> => {
  const identity = await findIdentityByProviderAndEmail("email", request.email);
  if (!identity || !identity.password_hash) {
    throw new EmailNotFoundError();
  }

  const passwordMatches = await bcrypt.compare(request.password, identity.password_hash);
  if (!passwordMatches) {
    throw new InvalidPasswordError();
  }

  if (identity.user.status === "deleted") {
    throw new WithdrawnAccountError();
  }

  await touchLastLogin(identity.user_id);
  const tokens = await issueTokens(identity.user_id, identity.email);
  return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, tokenType: "Bearer" };
};
