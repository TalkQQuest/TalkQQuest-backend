import { DeviceTokenPlatform } from "@prisma/client";
import { prisma } from "../../../config/database";

// fcm_token이 unique라 재등록(같은 토큰으로 다시 POST)은 upsert로 처리한다.
// 토큰이 다른 유저 명의로 넘어오는 경우(기기 재사용, 계정 전환 등)도 이 upsert로
// user_id가 최신 로그인 유저로 갱신된다 — 옛 유저에게 계속 발송되는 것을 막는다.
export const upsertDeviceToken = (userId: string, fcmToken: string, platform: DeviceTokenPlatform) =>
  prisma.device_Tokens.upsert({
    where: { fcm_token: fcmToken },
    create: { user_id: userId, fcm_token: fcmToken, platform, last_active_at: new Date() },
    update: { user_id: userId, platform, last_active_at: new Date() },
  });

export const findDeviceTokensByUserId = (userId: string) =>
  prisma.device_Tokens.findMany({ where: { user_id: userId } });

// Firebase가 "이 토큰은 더 이상 유효하지 않다"고 응답하면 호출한다.
export const deleteDeviceTokenByToken = (fcmToken: string) =>
  prisma.device_Tokens.deleteMany({ where: { fcm_token: fcmToken } });
