import { env } from "../../../config/env";
import { logger } from "../../../config/logger";

// RESEND_API_KEY가 없으면(로컬 개발 등) 실제 발송 없이 로그만 남긴다.
// 나중에 SES 등으로 바꿀 때는 이 파일만 교체하면 된다.
const sendCodeEmail = async (email: string, code: string, subject: string, html: string): Promise<void> => {
  if (!env.RESEND_API_KEY) {
    logger.info({ email, code }, `[dev-only] ${subject} (RESEND_API_KEY 미설정, 실제 발송 안 함)`);
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: env.RESEND_FROM_EMAIL, to: email, subject, html }),
  });

  if (!res.ok) {
    const body = await res.text();
    logger.error({ email, status: res.status, body }, "이메일 발송 실패 (Resend)");
    // 발송 실패해도 흐름 자체를 막지는 않는다 — 코드는 이미 Redis에 저장돼 있고,
    // 사용자가 재발송을 요청하면 된다. 발송 실패를 그대로 사용자 에러로 노출하지 않는다.
  }
};

export const sendVerificationEmail = (email: string, code: string) =>
  sendCodeEmail(
    email,
    code,
    "[TalkQuest] 이메일 인증번호",
    `<p>인증번호는 <strong>${code}</strong> 입니다. 5분 이내에 입력해주세요.</p>`
  );

export const sendPasswordResetEmail = (email: string, code: string) =>
  sendCodeEmail(
    email,
    code,
    "[TalkQuest] 비밀번호 재설정 인증번호",
    `<p>비밀번호 재설정 인증번호는 <strong>${code}</strong> 입니다. 5분 이내에 입력해주세요.</p>`
  );
