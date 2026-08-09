import { z } from "zod";

// POST /devices/fcm-token
export interface RegisterFcmTokenRequestDto {
  fcmToken: string;
  /** 안드로이드만 우선 지원. iOS는 DeviceTokenPlatform enum에는 있지만 아직 클라이언트가 없다. */
  platform: "android";
}

export const registerFcmTokenRequestSchema = z.object({
  fcmToken: z.string().min(1, "fcmToken이 필요합니다"),
  platform: z.literal("android"),
}) satisfies z.ZodType<RegisterFcmTokenRequestDto>;

export interface RegisterFcmTokenResponseDto {
  registered: true;
}
