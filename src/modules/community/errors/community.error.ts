// modules/community/errors/community.error.ts
import { AppError } from "../../../shared/errors/app-error";

export class CommunityNotFoundError extends AppError {
  constructor(message = "존재하지 않는 커뮤니티입니다.") {
    super("COMMUNITY_NOT_FOUND", 404, message);
  }
}

export class NotTheHostError extends AppError {
  constructor(message = "호스트만 처리할 수 있습니다.") {
    super("NOT_THE_HOST", 403, message);
  }
}

export class JoinClosedError extends AppError {
  constructor(message = "모집이 마감된 모임입니다.") {
    super("JOIN_CLOSED", 403, message);
  }
}

export class AlreadyRequestedError extends AppError {
  constructor(message = "이미 신청한 모임입니다.") {
    super("ALREADY_REQUESTED", 409, message);
  }
}

export class RequestNotFoundError extends AppError {
  constructor(message = "존재하지 않는 신청입니다.") {
    super("REQUEST_NOT_FOUND", 404, message);
  }
}

export class CommunityFullError extends AppError {
  constructor(message = "정원이 마감되었습니다.") {
    super("COMMUNITY_FULL", 409, message);
  }
}

export class HostCannotLeaveError extends AppError {
  constructor(message = "호스트는 탈퇴할 수 없습니다.") {
    super("HOST_CANNOT_LEAVE", 403, message);
  }
}

export class NotAMemberError extends AppError {
  constructor(message = "참여/신청 기록이 없는 모임입니다.") {
    super("NOT_A_MEMBER", 404, message);
  }
}

export class AlreadyBookmarkedError extends AppError {
  constructor(message = "이미 저장한 모임입니다.") {
    super("ALREADY_BOOKMARKED", 409, message);
  }
}

export class NotBookmarkedError extends AppError {
  constructor(message = "저장하지 않은 모임입니다.") {
    super("NOT_BOOKMARKED", 404, message);
  }
}

export class NotApprovedError extends AppError {
  constructor(message = "승인된 모임만 일정에 추가할 수 있습니다.") {
    super("NOT_APPROVED", 403, message);
  }
}
