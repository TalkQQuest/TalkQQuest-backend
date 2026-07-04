import bcrypt from "bcrypt";
import { Provider } from "@prisma/client";
import {
  createUserWithEmailIdentity,
  findIdentityByProviderAndEmail,
  touchLastLogin,
} from "../repositories/auth.repository";
import { DuplicatedEmailError, InvalidCredentialsError, TermsRequiredError } from "../errors/auth.error";
import { EmailAuthResponseDto, LoginRequestDto, SignupRequestDto } from "../dtos/email-auth.dto";
import { assertEmailVerified, clearEmailVerified } from "./email-verification.service";
import { issueTokens } from "./token.service";

const BCRYPT_SALT_ROUNDS = 10;

// CONVENTION.md `## 3.9` 계정 연동 참고 — 이미 가입된 이메일(수단 무관)이면 새 계정을 만들지 않는다.
export const signupWithEmail = async (request: SignupRequestDto): Promise<EmailAuthResponseDto> => {
  if (!request.termsAgreed) {
    throw new TermsRequiredError();
  }

  await assertEmailVerified(request.email);

  const providers: Provider[] = ["email", "kakao", "naver"];
  for (const provider of providers) {
    const existing = await findIdentityByProviderAndEmail(provider, request.email);
    if (existing) {
      throw new DuplicatedEmailError();
    }
  }

  const passwordHash = await bcrypt.hash(request.password, BCRYPT_SALT_ROUNDS);
  const { user, identity } = await createUserWithEmailIdentity({
    email: request.email,
    passwordHash,
    name: request.name,
    birthDate: request.birthDate,
    schoolOrJob: request.schoolOrJob,
  });
  await clearEmailVerified(request.email);

  const tokens = await issueTokens(user.id, identity.email);
  return {
    ...tokens,
    user: { id: user.id, email: identity.email as string, provider: "email" },
  };
};

export const loginWithEmail = async (request: LoginRequestDto): Promise<EmailAuthResponseDto> => {
  const identity = await findIdentityByProviderAndEmail("email", request.email);
  if (!identity || !identity.password_hash) {
    throw new InvalidCredentialsError();
  }

  const passwordMatches = await bcrypt.compare(request.password, identity.password_hash);
  if (!passwordMatches) {
    throw new InvalidCredentialsError();
  }

  await touchLastLogin(identity.user_id);
  const tokens = await issueTokens(identity.user_id, identity.email);
  return {
    ...tokens,
    user: { id: identity.user_id, email: identity.email as string, provider: "email" },
  };
};
