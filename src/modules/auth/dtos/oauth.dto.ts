import { z } from "zod";

// design.md `### Auth APIs` > POST /auth/oauth/kakao, /auth/oauth/naver 참고.
export interface DeviceInfoDto {
  platform: "android";
  model?: string;
  osVersion?: string;
  fcmToken?: string;
}

export interface OAuthLoginRequestDto {
  /**
   * Android 앱이 Kakao/Naver SDK로 클라이언트에서 직접 로그인해서 발급받은 Provider Access Token.
   * 백엔드가 발급하는 값이 아니라 프론트(안드로이드 SDK)가 그대로 전달하는 값이며,
   * 백엔드는 이 값을 그대로 카카오/네이버 사용자정보 조회 API에 넘겨 검증만 한다
   * (Authorization Code 교환은 하지 않음).
   * @example "카카오/네이버 SDK가 발급한 access token 문자열"
   */
  providerAccessToken: string;
  deviceInfo?: DeviceInfoDto;
}

// tsoa는 z.infer 타입 별칭의 OpenAPI 스키마를 생성하지 못해, 검증용 스키마는 위 인터페이스와 별개로 둔다.
const deviceInfoSchema = z.object({
  platform: z.literal("android"),
  model: z.string().optional(),
  osVersion: z.string().optional(),
  fcmToken: z.string().optional(),
});

export const oauthLoginRequestSchema = z.object({
  providerAccessToken: z.string().min(1, "providerAccessToken이 필요합니다"),
  deviceInfo: deviceInfoSchema.optional(),
}) satisfies z.ZodType<OAuthLoginRequestDto>;

export interface OAuthUserDto {
  id: string;
  email: string | null;
  nickname: string | null;
  provider: "kakao" | "naver" | "email";
}

export interface OAuthLoginResponseDto {
  // needsLinking === true인 경우 이미 다른 수단으로 가입된 계정이라 로그인을 완료하지 않으므로 null.
  // 연동을 실제로 수행하는 API는 아직 정의되지 않았다 (design.md 계정 연동 문단 참고).
  accessToken: string | null;
  refreshToken: string | null;
  expiresIn: number | null;
  isNewUser: boolean;
  needsLinking: boolean;
  user: OAuthUserDto;
}
