import { AppError } from "../../../shared/errors/app-error";

export class ItemNotFoundError extends AppError {
    constructor(message = "존재하지 않는 항목입니다.") {
        super("ITEM_NOT_FOUND", 404, message);
    }
}

export class PhraseNotFoundError extends AppError {
    constructor(message = "존재하지 않는 문장입니다.") {
        super("PHRASE_NOT_FOUND", 404, message);
    }
}

export class FolderNotFoundError extends AppError {
    constructor(message = "존재하지 않는 폴더입니다.") {
        super("FOLDER_NOT_FOUND", 404, message);
    }
}

export class ArchiveConversationNotFoundError extends AppError {
    constructor(message = "존재하지 않는 대화입니다.") {
        super("CONVERSATION_NOT_FOUND", 404, message);
    }
}

export class EmptyPhraseContentError extends AppError {
    constructor() {
        super("VALIDATION_ERROR", 400, "저장할 문장을 입력해주세요.");
    }
}