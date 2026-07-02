import { Provider } from "@prisma/client";
import {
  createUserWithIdentity,
  findIdentityByProvider,
  findIdentityByProviderAndEmail,
  touchLastLogin,
} from "../repositories/auth.repository";
import { OAuthLoginRequestDto, OAuthLoginResponseDto } from "../dtos/oauth.dto";
import { verifyKakaoToken, verifyNaverToken } from "./provider.service";
import { issueTokens } from "./token.service";

// CONVENTION.md `## 3.9 인증 (JWT)` > 계정 연동 문단 참고.
const loginWithProvider = async (
  provider: Provider,
  request: OAuthLoginRequestDto
): Promise<OAuthLoginResponseDto> => {
  const profile =
    provider === "kakao"
      ? await verifyKakaoToken(request.providerAccessToken)
      : await verifyNaverToken(request.providerAccessToken);

  const existingIdentity = await findIdentityByProvider(provider, profile.providerUserId);

  if (existingIdentity) {
    await touchLastLogin(existingIdentity.user_id);
    const tokens = await issueTokens(
      existingIdentity.user_id,
      existingIdentity.email,
      request.deviceInfo
    );
    return {
      ...tokens,
      isNewUser: false,
      needsLinking: false,
      user: {
        id: existingIdentity.user_id,
        email: existingIdentity.email,
        nickname: existingIdentity.user.user_profile?.nickname ?? null,
        provider,
      },
    };
  }

  // 같은 이메일로 다른 수단(카카오/네이버/이메일)이 이미 가입되어 있으면 새 계정을 만들지 않는다.
  if (profile.email) {
    const otherProviders: Provider[] = (["kakao", "naver", "email"] as Provider[]).filter(
      (p) => p !== provider
    );
    for (const otherProvider of otherProviders) {
      const linkedIdentity = await findIdentityByProviderAndEmail(otherProvider, profile.email);
      if (linkedIdentity) {
        return {
          accessToken: null,
          refreshToken: null,
          expiresIn: null,
          isNewUser: false,
          needsLinking: true,
          user: {
            id: linkedIdentity.user_id,
            email: linkedIdentity.email,
            nickname: linkedIdentity.user.user_profile?.nickname ?? null,
            provider: otherProvider,
          },
        };
      }
    }
  }

  const { user, identity } = await createUserWithIdentity(
    provider,
    profile.providerUserId,
    profile.email
  );
  const tokens = await issueTokens(user.id, identity.email, request.deviceInfo);

  return {
    ...tokens,
    isNewUser: true,
    needsLinking: false,
    user: {
      id: user.id,
      email: identity.email,
      nickname: null,
      provider,
    },
  };
};

export const loginWithKakao = (request: OAuthLoginRequestDto) => loginWithProvider("kakao", request);
export const loginWithNaver = (request: OAuthLoginRequestDto) => loginWithProvider("naver", request);
