import { DeviceTokenPlatform } from "@prisma/client";
import * as deviceRepository from "../repositories/device.repository";
import { RegisterFcmTokenRequestDto, RegisterFcmTokenResponseDto } from "../dtos/device.dto";

// POST /devices/fcm-token — 로그인과 무관하게 언제든 호출 가능하다(토큰 재발급/로테이션은
// 클라이언트 이벤트라 서버가 스스로 알 수 없어, 앱이 매번 능동적으로 알려줘야 한다).
export const registerFcmToken = async (
  userId: string,
  body: RegisterFcmTokenRequestDto
): Promise<RegisterFcmTokenResponseDto> => {
  await deviceRepository.upsertDeviceToken(userId, body.fcmToken, body.platform as DeviceTokenPlatform);
  return { registered: true };
};
