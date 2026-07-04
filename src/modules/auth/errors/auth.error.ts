import { ErrorCodes } from "../../../shared/constants/error-codes";
import { AppError } from "../../../shared/errors/app-error";

export class InvalidProviderTokenError extends AppError {
  constructor(message = "Provider Access Token이 유효하지 않습니다") {
    super(ErrorCodes.UNAUTHORIZED, 401, message);
  }
}

// CONVENTION.md `## 3.8` 도메인별 세부 코드 — 공통 코드로 표현이 안 되는 인증 도메인 에러.
export class DuplicatedEmailError extends AppError {
  constructor(message = "이미 가입된 이메일입니다") {
    super("DUPLICATED_EMAIL", 409, message);
  }
}

export class InvalidVerificationCodeError extends AppError {
  constructor(message = "인증번호가 올바르지 않거나 만료되었습니다") {
    super("INVALID_VERIFICATION_CODE", 400, message);
  }
}

export class TermsRequiredError extends AppError {
  constructor(message = "약관 동의가 필요합니다") {
    super("TERMS_REQUIRED", 400, message);
  }
}

export class InvalidCredentialsError extends AppError {
  constructor(message = "이메일 또는 비밀번호가 올바르지 않습니다") {
    super(ErrorCodes.UNAUTHORIZED, 401, message);
  }
}
