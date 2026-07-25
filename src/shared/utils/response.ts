// CONVENTION.md `## 3.7 공통 응답 포맷` 참고 — 모든 API 응답은 이 형식을 따릅니다.
export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data: T | null;
  errorCode: string | null;
}

export const success = <T>(data: T, message = "OK"): ApiResponse<T> => ({
  success: true,
  message,
  data,
  errorCode: null,
});

export const failure = (errorCode: string, message: string): ApiResponse<null> => ({
  success: false,
  message,
  data: null,
  errorCode,
});
