import { ErrorCodes } from "../../../shared/constants/error-codes";
import { AppError } from "../../../shared/errors/app-error";

export class TermsNotFoundError extends AppError {
  constructor(message = "활성화된 약관이 없습니다") {
    super(ErrorCodes.NOT_FOUND, 404, message);
  }
}
