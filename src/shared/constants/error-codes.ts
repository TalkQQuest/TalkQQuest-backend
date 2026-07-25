// CONVENTION.md `## 3.8 Exception / Error Code` 와 동일한 표를 코드로 옮긴 파일입니다.
// 도메인 에러가 늘어나면 여기에 먼저 등록하고, 각 도메인의 *.error.ts 에서 사용합니다.

export const ErrorCodes = {
  // 공통 (기능명세서 PDF 확정)
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNAUTHORIZED: "UNAUTHORIZED",
  NOT_FOUND: "NOT_FOUND",
  DUPLICATED: "DUPLICATED",
  SERVER_ERROR: "SERVER_ERROR",

  // 공통 (PDF에 없음 — 403이 필요한 케이스가 생기면 그때 확정)
  FORBIDDEN: "FORBIDDEN",

  // 공통 (API 명세서 기준 — 인증번호/토큰 등 시간 제한이 있는 리소스의 만료)
  EXPIRED: "EXPIRED",

  // Payment 도메인 (API 명세서 `결제 요청` 기준)
  PAYMENT_FAILED: "PAYMENT_FAILED",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
