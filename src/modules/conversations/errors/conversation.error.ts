import { ErrorCodes } from "../../../shared/constants/error-codes";

const ConversationErrorCodes = {
    ...ErrorCodes,
    MISSION_NOT_FOUND: "MISSION_NOT_FOUND",
    CONVERSATION_NOT_FOUND: "CONVERSATION_NOT_FOUND",
    FEEDBACK_INPUT_TOO_SHORT: "FEEDBACK_INPUT_TOO_SHORT",
    ALREADY_FINISHED: "VALIDATION_ERROR",
    } as const;

    export class ConversationError extends Error {
    constructor(
        public readonly errorCode: string,
        message: string,
        public readonly statusCode: number
    ) {
        super(message);
        this.name = "ConversationError";
    }

    static missionNotFound() {
        return new ConversationError(
        ConversationErrorCodes.MISSION_NOT_FOUND,
        "존재하지 않는 미션입니다.",
        404
        );
    }

    static conversationNotFound() {
        return new ConversationError(
        ConversationErrorCodes.CONVERSATION_NOT_FOUND,
        "존재하지 않는 대화입니다.",
        404
        );
    }

    static invalidMode() {
        return new ConversationError(
        ConversationErrorCodes.VALIDATION_ERROR,
        "mode 값이 올바르지 않습니다.",
        400
        );
    }

    static feedbackInputTooShort() {
        return new ConversationError(
        ConversationErrorCodes.FEEDBACK_INPUT_TOO_SHORT,
        "대화 내용이 너무 짧습니다.",
        400
        );
    }

    static alreadyFinished() {
        return new ConversationError(
        ConversationErrorCodes.ALREADY_FINISHED,
        "이미 종료된 대화입니다.",
        400
        );
    }
}