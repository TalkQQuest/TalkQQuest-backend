import { ErrorCodes } from "../../../shared/constants/error-codes";
import { AppError } from "../../../shared/errors/app-error";

export class InvalidProviderTokenError extends AppError {
  constructor(message = "Provider Access Token이 유효하지 않습니다") {
    super(ErrorCodes.UNAUTHORIZED, 401, message);
  }
}
