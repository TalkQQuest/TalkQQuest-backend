import { AppError } from "../../../shared/errors/app-error";
import { ErrorCodes } from "../../../shared/constants/error-codes";

export class ReportNotFoundError extends AppError {
  constructor(message = "존재하지 않는 리포트입니다.") {
    super(ErrorCodes.NOT_FOUND, 404, message);
  }
}
