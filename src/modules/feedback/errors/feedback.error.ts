// modules/feedback/errors/feedback.error.ts
import { AppError } from "../../../shared/errors/app-error";

export class FeedbackConversationNotFoundError extends AppError {
  constructor(message = "존재하지 않는 대화입니다.") {
    super("CONVERSATION_NOT_FOUND", 404, message);
  }
}

// 대화 내 메시지 수/길이가 분석 기준에 미달할 때.
export class FeedbackInputTooShortError extends AppError {
  constructor(message = "대화 내용이 너무 짧아 피드백을 생성할 수 없습니다.") {
    super("FEEDBACK_INPUT_TOO_SHORT", 400, message);
  }
}

// POST /feedback: 이미 생성 중인(pending) 피드백이 있어 중복 생성을 막을 때.
// POST /feedback/{id}/retry: 이전 재생성 요청이 아직 진행 중일 때.
// 두 호출부 모두 errorCode는 같고 message만 다르다(명세서 에러 표 참고).
export class FeedbackNotReadyError extends AppError {
  constructor(message = "피드백이 아직 준비되지 않았습니다.") {
    super("FEEDBACK_NOT_READY", 409, message);
  }
}

export class FeedbackNotFoundError extends AppError {
  constructor(message = "존재하지 않는 피드백입니다.") {
    super("FEEDBACK_NOT_FOUND", 404, message);
  }
}
