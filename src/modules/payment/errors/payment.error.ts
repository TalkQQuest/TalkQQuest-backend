import { ErrorCodes } from "../../../shared/constants/error-codes";
import { AppError } from "../../../shared/errors/app-error";

export class InvalidPlanError extends AppError {
  constructor(message = "유효하지 않은 플랜입니다.") {
    super(ErrorCodes.VALIDATION_ERROR, 400, message);
  }
}

export class ActiveSubscriptionExistsError extends AppError {
  constructor(message = "이미 활성화된 구독이 있습니다.") {
    super(ErrorCodes.DUPLICATED, 409, message);
  }
}

export class NoActiveSubscriptionError extends AppError {
  constructor(message = "활성화된 구독이 없습니다.") {
    super(ErrorCodes.NOT_FOUND, 404, message);
  }
}

export class InvalidPaymentError extends AppError {
  constructor(message = "결제 정보가 올바르지 않습니다.") {
    super(ErrorCodes.VALIDATION_ERROR, 400, message);
  }
}

// 실제 PG 연동이 없어 현재는 도달하지 않는 mock 결제 실패 케이스 —
// 명세서에 정의된 402 응답 형태를 남겨두기 위해 정의만 해둔다.
export class PaymentFailedError extends AppError {
  constructor(message = "결제에 실패하였습니다.") {
    super(ErrorCodes.PAYMENT_FAILED, 402, message);
  }
}
