import { Prisma, Provider } from "@prisma/client";
import {
  createUserWithIdentity,
  findIdentityByProvider,
  findIdentityByProviderAndEmail,
  touchLastLogin,
} from "../repositories/auth.repository";
import { OAuthLoginRequestDto, OAuthLoginResponseDto } from "../dtos/oauth.dto";
import { verifyKakaoToken, verifyNaverToken } from "./provider.service";
import { issueTokens } from "./token.service";
import { WithdrawnAccountError } from "../errors/auth.error";
import { upsertDeviceToken } from "../../device/repositories/device.repository";
import { logger } from "../../../config/logger";

const isUniqueConstraintError = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

// #159 — 소셜 로그인 요청에 이미 실려 오는 deviceInfo.fcmToken을 Device_Tokens에도 반영한다.
// 전용 등록 API(POST /devices/fcm-token)가 모든 로그인 방식을 이미 커버하므로 이건 필수 경로는
// 아니고, 앱이 등록 API 호출을 놓치거나 타이밍이 어긋나도 로그인 시점에 한 번 더 반영되게 하는
// 보험이다. 실패해도 로그인 자체를 막으면 안 되므로 흡수한다.
const registerDeviceTokenIfPresent = async (
  userId: string,
  deviceInfo?: OAuthLoginRequestDto["deviceInfo"]
): Promise<void> => {
  if (!deviceInfo?.fcmToken) return;
  try {
    await upsertDeviceToken(userId, deviceInfo.fcmToken, "android");
  } catch (error) {
    logger.warn({ err: error, userId }, "로그인 시점 FCM 토큰 등록 실패 (로그인은 정상 처리)");
  }
};

const loginExistingIdentity = async (
  provider: Provider,
  identity: NonNullable<Awaited<ReturnType<typeof findIdentityByProvider>>>,
  deviceInfo?: OAuthLoginRequestDto["deviceInfo"]
): Promise<OAuthLoginResponseDto> => {
  if (identity.user.status === "deleted") {
    throw new WithdrawnAccountError();
  }

  await touchLastLogin(identity.user_id);
  const tokens = await issueTokens(identity.user_id, identity.email, deviceInfo);
  await registerDeviceTokenIfPresent(identity.user_id, deviceInfo);
  return {
    ...tokens,
    isNewUser: false,
    needsLinking: false,
    user: {
      id: identity.user_id,
      email: identity.email,
      nickname: identity.user.user_profile?.nickname ?? null,
      provider,
    },
  };
};

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
    return loginExistingIdentity(provider, existingIdentity, request.deviceInfo);
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

  try {
    const { user, identity } = await createUserWithIdentity(
      provider,
      profile.providerUserId,
      profile.email
    );
    const tokens = await issueTokens(user.id, identity.email, request.deviceInfo);
    await registerDeviceTokenIfPresent(user.id, request.deviceInfo);

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
  } catch (error) {
    // 동시에 들어온 중복 요청(연타/재시도)이 먼저 계정을 만든 경우, (provider, provider_user_id)
    // 유니크 제약(P2002)에 걸린다. 실패로 처리하지 않고 방금 생성된 계정으로 로그인 처리한다.
    if (!isUniqueConstraintError(error)) {
      throw error;
    }
    const raceWinnerIdentity = await findIdentityByProvider(provider, profile.providerUserId);
    if (!raceWinnerIdentity) {
      throw error;
    }
    return loginExistingIdentity(provider, raceWinnerIdentity, request.deviceInfo);
  }
};

export const loginWithKakao = (request: OAuthLoginRequestDto) => loginWithProvider("kakao", request);
export const loginWithNaver = (request: OAuthLoginRequestDto) => loginWithProvider("naver", request);
