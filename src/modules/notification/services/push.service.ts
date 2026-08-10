import { getFirebaseMessaging } from "../../../config/firebase";
import { logger } from "../../../config/logger";
import * as deviceRepository from "../../device/repositories/device.repository";

export interface PushPayload {
  title: string;
  body: string;
  data: {
    type: string;
    referenceId?: string;
    referenceType?: string;
  };
}

// Firebase가 이 코드로 응답하면 그 토큰은 더 이상 유효하지 않다는 뜻이다.
// 죽은 토큰에 계속 발송을 시도하지 않도록 등록을 지운다.
const INVALID_TOKEN_ERROR_CODES = new Set([
  "messaging/invalid-registration-token",
  "messaging/registration-token-not-registered",
]);

// 데이터 페이로드는 FCM 요구사항상 값이 전부 string이어야 한다.
const toStringData = (data: PushPayload["data"]): Record<string, string> => {
  const entries: [string, string][] = [["type", data.type]];
  if (data.referenceId) entries.push(["referenceId", data.referenceId]);
  if (data.referenceType) entries.push(["referenceType", data.referenceType]);
  return Object.fromEntries(entries);
};

// 이 유저의 등록된 기기 전체로 발송한다. 실패는 절대 위로 던지지 않는다 —
// 알림 자체(DB 행 생성)는 이미 끝난 상태라, 푸시 발송 실패가 그 성공을 무효로 만들면 안 된다.
export const sendPushToUser = async (userId: string, payload: PushPayload): Promise<void> => {
  const messaging = getFirebaseMessaging();
  if (!messaging) {
    logger.info({ userId }, "[dev-only] 푸시 발송 건너뜀 (FIREBASE_* 미설정)");
    return;
  }

  // 이 함수 전체가 "절대 reject하지 않는다"는 계약을 스스로 지켜야 한다 — 토큰 조회 자체가
  // 실패해도(DB 일시 오류 등) 위로 던지지 않고 로그만 남기고 끝낸다.
  let tokens: Awaited<ReturnType<typeof deviceRepository.findDeviceTokensByUserId>>;
  try {
    tokens = await deviceRepository.findDeviceTokensByUserId(userId);
  } catch (error) {
    logger.warn({ err: error, userId }, "기기 토큰 조회 실패로 푸시 발송을 건너뜀");
    return;
  }
  if (tokens.length === 0) return;

  await Promise.all(
    tokens.map(async (token) => {
      try {
        await messaging.send({
          token: token.fcm_token,
          notification: { title: payload.title, body: payload.body },
          data: toStringData(payload.data),
        });
      } catch (error) {
        const code = (error as { code?: string } | undefined)?.code;
        if (code && INVALID_TOKEN_ERROR_CODES.has(code)) {
          // 삭제 실패도 다른 기기 발송을 막으면 안 되므로 여기서 흡수한다.
          try {
            await deviceRepository.deleteDeviceTokenByToken(token.fcm_token);
          } catch (deleteError) {
            logger.warn({ err: deleteError, userId, deviceTokenId: token.id }, "무효 토큰 삭제 실패");
          }
          return;
        }
        logger.warn({ err: error, userId, deviceTokenId: token.id }, "푸시 발송 실패");
      }
    })
  );
};
