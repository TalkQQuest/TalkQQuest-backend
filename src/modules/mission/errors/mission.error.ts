// modules/mission/errors/mission.error.ts
import { AppError } from "../../../shared/errors/app-error";

export class MissionNotFoundError extends AppError {
  constructor(message = "존재하지 않는 미션입니다.") {
    super("MISSION_NOT_FOUND", 404, message);
  }
}

export class SaveNotFoundError extends AppError {
  constructor(message = "저장된 기록이 없습니다.") {
    super("SAVE_NOT_FOUND", 404, message);
  }
}

// 미션 추천(1단계) — 온보딩 프로필이 없거나 미완료라 추천 컨텍스트를 만들 수 없는 경우.
// 호출부는 이 에러를 잡아 온보딩으로 유도하거나 입문 템플릿 미션으로 폴백할 수 있다.
export class MissionProfileNotFoundError extends AppError {
  constructor(message = "온보딩이 완료되지 않아 미션을 추천할 수 없습니다.") {
    super("MISSION_PROFILE_NOT_FOUND", 404, message);
  }
}
// GET/PUT/DELETE /missions/{missionId}/playbook — 아직 생성되지 않은 미션.
// 플레이북은 첫 대화 시작 시 자동 생성되므로, 대화가 한 번도 없던 미션이면 이 상태가 정상이다.
export class PlaybookNotFoundError extends AppError {
  constructor(message = "이 미션에는 아직 대화 플레이북이 없습니다.") {
    super("PLAYBOOK_NOT_FOUND", 404, message);
  }
}

// POST /missions/{missionId}/playbook/regenerate — LLM 생성이 실패한 경우.
export class PlaybookGenerationFailedError extends AppError {
  constructor(message = "대화 플레이북 생성에 실패했습니다. 잠시 후 다시 시도해주세요.") {
    super("PLAYBOOK_GENERATION_FAILED", 503, message);
  }
}

// POST /missions/{missionId}/setup-guideline/regenerate — LLM 생성이 실패한 경우.
export class SetupGuidelineGenerationFailedError extends AppError {
  constructor(message = "미션 준비 가이드라인 생성에 실패했습니다. 잠시 후 다시 시도해주세요.") {
    super("SETUP_GUIDELINE_GENERATION_FAILED", 503, message);
  }
}

// POST /missions/from-recommendation — recommendationLogId가 존재하지 않거나 다른 사용자 것인 경우.
export class RecommendationLogNotFoundError extends AppError {
  constructor(message = "존재하지 않는 추천 기록입니다.") {
    super("RECOMMENDATION_LOG_NOT_FOUND", 404, message);
  }
}

// GET /missions/today?refresh=true — 하루 새로고침 횟수(MISSION_REFRESH_LIMIT)를 모두 쓴 경우.
// 429를 쓰는 이유: 요청 자체는 올바르고 권한도 있으나 사용량 한도에 걸린 상태라,
// 클라이언트가 "내일 다시" 또는 "현재 미션 유지"로 안내하면 되는 상황이기 때문이다.
export class MissionRefreshLimitExceededError extends AppError {
  constructor(message = "오늘 미션을 새로 받을 수 있는 횟수를 모두 사용했습니다.") {
    super("MISSION_REFRESH_LIMIT_EXCEEDED", 429, message);
  }
}

// GET /missions/today?date=... — 서버 기준 오늘과 너무 동떨어진 날짜를 보낸 경우.
export class InvalidMissionDateError extends AppError {
  constructor(message = "오늘 날짜가 올바르지 않습니다.") {
    super("INVALID_MISSION_DATE", 400, message);
  }
}

// POST /missions/{missionId}/setups — 이 미션의 setup_guideline.disabled에 걸린 조합을 선택한 경우.
// 앱이 비활성 처리를 놓치거나(구버전) 우회 요청을 보낸 경우를 서버에서 최종적으로 막는다.
export class MissionSetupDisabledCombinationError extends AppError {
  constructor(message = "이 미션에서는 선택할 수 없는 조합입니다.", data?: unknown) {
    super("MISSION_SETUP_DISABLED_COMBINATION", 400, message, data);
  }
}
