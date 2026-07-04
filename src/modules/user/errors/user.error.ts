import { AppError } from "../../../shared/errors/app-error";

// CONVENTION.md `## 3.8` 도메인별 세부 코드 — 공통 코드로 표현이 안 되는 온보딩 도메인 에러.
export class InvalidStepError extends AppError {
  constructor(message = "잘못된 온보딩 단계입니다.") {
    super("INVALID_STEP", 400, message);
  }
}

export class IncompleteOnboardingError extends AppError {
  constructor(message = "온보딩 단계가 완료되지 않았습니다.") {
    super("INCOMPLETE_ONBOARDING", 400, message);
  }
}
