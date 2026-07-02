import { ErrorCodes } from "../constants/error-codes";
import { AppError } from "./app-error";

export class ValidationError extends AppError {
  constructor(details?: unknown) {
    super(ErrorCodes.VALIDATION_ERROR, 400, "입력값이 올바르지 않습니다", details);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "리소스를 찾을 수 없습니다", data?: unknown) {
    super(ErrorCodes.NOT_FOUND, 404, message, data);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "인증이 필요합니다") {
    super(ErrorCodes.UNAUTHORIZED, 401, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "권한이 없습니다") {
    super(ErrorCodes.FORBIDDEN, 403, message);
  }
}
