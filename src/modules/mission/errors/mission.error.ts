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