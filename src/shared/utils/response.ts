// CONVENTION.md `## 3.7 공통 응답 포맷` 참고 — 모든 API 응답은 이 형식을 따릅니다.
export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  error: ApiErrorBody | null;
}

export const success = <T>(data: T): ApiResponse<T> => ({
  success: true,
  data,
  error: null,
});

export const failure = (error: ApiErrorBody): ApiResponse<null> => ({
  success: false,
  data: null,
  error,
});
