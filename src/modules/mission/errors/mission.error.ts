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