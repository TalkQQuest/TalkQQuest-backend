import { App, cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging, Messaging } from "firebase-admin/messaging";
import { env } from "./env";
import { logger } from "./logger";

// #159 — FIREBASE_* 셋 다 없으면(로컬 개발 등) 푸시 발송 자체를 건너뛴다.
// RESEND_API_KEY 없을 때 이메일 발송을 건너뛰는 것과 같은 패턴.
const isConfigured =
  !!env.FIREBASE_PROJECT_ID && !!env.FIREBASE_CLIENT_EMAIL && !!env.FIREBASE_PRIVATE_KEY;

let app: App | null = null;

// .env/GitHub Secret에는 PEM의 개행이 "\n" 리터럴 두 글자로 들어있으므로 실제 개행으로 되돌린다.
const normalizePrivateKey = (key: string): string => key.replace(/\\n/g, "\n");

const getFirebaseApp = (): App | null => {
  if (!isConfigured) return null;
  if (app) return app;

  const existing = getApps();
  if (existing.length > 0) {
    app = existing[0];
    return app;
  }

  app = initializeApp({
    credential: cert({
      projectId: env.FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      privateKey: normalizePrivateKey(env.FIREBASE_PRIVATE_KEY!),
    }),
  });
  logger.info({ projectId: env.FIREBASE_PROJECT_ID }, "Firebase Admin SDK 초기화 완료");
  return app;
};

// 키가 없으면 null — 호출부(push.service.ts)가 null이면 발송을 건너뛰고 로그만 남긴다.
export const getFirebaseMessaging = (): Messaging | null => {
  const firebaseApp = getFirebaseApp();
  return firebaseApp ? getMessaging(firebaseApp) : null;
};
