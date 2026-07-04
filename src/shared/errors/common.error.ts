import { ErrorCodes } from "../constants/error-codes";
import { AppError } from "./app-error";

export class ValidationError extends AppError {
  constructor(message = "입력값이 올바르지 않습니다", data?: unknown) {
    super(ErrorCodes.VALIDATION_ERROR, 400, message, data);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "리소스를 찾을 수 없습니다", data?: unknown) {
    super(ErrorCodes.NOT_FOUND, 404, message, data);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "인증이 필요합니다", data?: unknown) {
    super(ErrorCodes.UNAUTHORIZED, 401, message, data);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "권한이 없습니다", data?: unknown) {
    super(ErrorCodes.FORBIDDEN, 403, message, data);
  }
}

export class DuplicatedError extends AppError {
  constructor(message = "이미 존재하는 리소스입니다", data?: unknown) {
    super(ErrorCodes.DUPLICATED, 409, message, data);
  }
}
