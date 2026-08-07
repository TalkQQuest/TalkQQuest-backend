import { AppError } from "../../../shared/errors/app-error";
import { ErrorCodes } from "../../../shared/constants/error-codes";

export class ReportNotFoundError extends AppError {
  constructor(message = "존재하지 않는 리포트입니다.") {
    super(ErrorCodes.NOT_FOUND, 404, message);
  }
}

// #145 — 성장 리포트 저장(POST /reports)이 conversationId를 요구하면서 추가된 에러.
export class ReportConversationNotFoundError extends AppError {
  constructor(message = "존재하지 않는 대화입니다.") {
    super(ErrorCodes.NOT_FOUND, 404, message);
  }
}

export class WeeklyCompareReportNotFoundError extends AppError {
  constructor(message = "존재하지 않는 주간 비교 리포트입니다.") {
    super(ErrorCodes.NOT_FOUND, 404, message);
  }
}
