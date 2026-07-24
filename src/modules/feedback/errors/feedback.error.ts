import { AppError } from "../../../shared/errors/app-error";

export class FeedbackNotFoundError extends AppError {
  constructor(message = "존재하지 않는 피드백입니다.") {
    super("FEEDBACK_NOT_FOUND", 404, message);
  }
}
