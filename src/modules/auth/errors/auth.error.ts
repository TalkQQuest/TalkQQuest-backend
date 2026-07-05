import { ErrorCodes } from "../../../shared/constants/error-codes";
import { AppError } from "../../../shared/errors/app-error";

export class InvalidProviderTokenError extends AppError {
  constructor(message = "Provider Access Token이 유효하지 않습니다") {
    super(ErrorCodes.UNAUTHORIZED, 401, message);
  }
}

// API 명세서 기준 인증 도메인 세부 코드.
export class InvalidVerificationCodeError extends AppError {
  constructor(message = "인증 코드가 올바르지 않습니다") {
    super(ErrorCodes.VALIDATION_ERROR, 400, message);
  }
}

export class VerificationCodeExpiredError extends AppError {
  constructor(message = "인증 코드가 만료되었습니다") {
    super("EXPIRED", 410, message);
  }
}

export class UnverifiedEmailError extends AppError {
  constructor(message = "이메일 인증이 완료되지 않았습니다") {
    super("UNVERIFIED_EMAIL", 422, message);
  }
}

export class EmailNotFoundError extends AppError {
  constructor(message = "존재하지 않는 이메일입니다") {
    super(ErrorCodes.NOT_FOUND, 404, message);
  }
}

export class InvalidPasswordError extends AppError {
  constructor(message = "비밀번호가 일치하지 않습니다") {
    super("INVALID_PASSWORD", 400, message);
  }
}

export class RefreshTokenExpiredError extends AppError {
  constructor(message = "만료된 토큰입니다") {
    super("EXPIRED", 410, message);
  }
}
