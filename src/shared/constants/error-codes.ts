// CONVENTION.md `## 3.8 Exception / Error Code` 와 동일한 표를 코드로 옮긴 파일입니다.
// 도메인 에러가 늘어나면 여기에 먼저 등록하고, 각 도메인의 *.error.ts 에서 사용합니다.

export const ErrorCodes = {
  // 공통 (E)
  VALIDATION_ERROR: "E4001",
  NOT_FOUND: "E4041",
  INTERNAL_SERVER_ERROR: "E5001",

  // Auth (A)
  UNAUTHORIZED: "A4011",
  FORBIDDEN: "A4031",

  // Token (T)
  INSUFFICIENT_TOKENS: "T4021",

  // Community (CM)
  COMMUNITY_FULL: "CM4091",

  // Payment (P)
  PAYMENT_FAILED: "P4022",

  // AI Engine
  AI_SERVICE_UNAVAILABLE: "AI5031",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
