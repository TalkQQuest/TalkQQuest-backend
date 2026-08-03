// modules/mission/controllers/playbook.controller.ts
//
// 대화 플레이북 조회·수정 (운영·튜닝용).
//
// ⚠️ 플레이북은 **미션 단위로 모든 사용자가 공유**한다. 한 명이 고치면 그 미션으로 대화하는
//    모두에게 적용되므로 사실상 관리자 기능이다. 현재 프로젝트에 관리자 역할이 없어
//    인증만 통과하면 호출할 수 있다 — 운영 배포 전 권한 게이트를 반드시 추가할 것.

import {
  Body,
  Controller,
  Delete,
  Get,
  Middlewares,
  Path,
  Post,
  Put,
  Response,
  Route,
  Security,
  SuccessResponse,
  Tags,
} from "tsoa";
import { authorizeUser } from "../../../middlewares/auth";
import { validate } from "../../../middlewares/validator";
import { success, ApiResponse } from "../../../shared/utils/response";
import {
  PlaybookRequestDto,
  playbookRequestSchema,
  PlaybookResponseDto,
} from "../dtos/playbook.dto";
import * as playbookAdmin from "../services/playbook-admin.service";

@Route("missions")
@Tags("Mission Playbook")
export class PlaybookController extends Controller {
  /**
   * @summary 대화 플레이북 조회
   *
   * 응답에는 임베딩이 포함되지 않는다(4096차원 × 10개라 1MB가 넘고 사람이 볼 값이 아니다).
   * 임베딩 보유 여부는 `hasEmbeddings`로 확인한다.
   */
  @Get("{missionId}/playbook")
  @Security("bearerAuth")
  @Middlewares(authorizeUser())
  @Response(401, "UNAUTHORIZED")
  @Response(404, "MISSION_NOT_FOUND")
  @Response(404, "PLAYBOOK_NOT_FOUND")
  public async getPlaybook(@Path() missionId: string): Promise<ApiResponse<PlaybookResponseDto>> {
    return success(await playbookAdmin.getPlaybook(missionId));
  }

  /**
   * @summary 대화 플레이북 수정
   *
   * 보낸 내용으로 통째로 교체한다. 임베딩은 **서버가 다시 계산**하므로 보낼 필요가 없다
   * (텍스트만 바꾸고 옛 임베딩을 두면 매칭이 조용히 어긋난다).
   */
  @Put("{missionId}/playbook")
  @Security("bearerAuth")
  @Middlewares(authorizeUser(), validate(playbookRequestSchema))
  @Response(400, "VALIDATION_ERROR")
  @Response(401, "UNAUTHORIZED")
  @Response(404, "MISSION_NOT_FOUND")
  public async replacePlaybook(
    @Path() missionId: string,
    @Body() body: PlaybookRequestDto
  ): Promise<ApiResponse<PlaybookResponseDto>> {
    const result = await playbookAdmin.replacePlaybook(missionId, body);
    return success(result, "플레이북이 수정되었습니다.");
  }

  /**
   * @summary 대화 플레이북 재생성
   *
   * LLM으로 새로 만들어 덮어쓴다. 자동 생성 결과가 마음에 들지 않을 때 쓴다.
   */
  @Post("{missionId}/playbook/regenerate")
  @Security("bearerAuth")
  @Middlewares(authorizeUser())
  @Response(401, "UNAUTHORIZED")
  @Response(404, "MISSION_NOT_FOUND")
  @Response(503, "PLAYBOOK_GENERATION_FAILED")
  public async regeneratePlaybook(
    @Path() missionId: string
  ): Promise<ApiResponse<PlaybookResponseDto>> {
    const result = await playbookAdmin.regeneratePlaybook(missionId);
    return success(result, "플레이북이 재생성되었습니다.");
  }

  /**
   * @summary 대화 플레이북 삭제
   *
   * 다음 대화 시작 시 자동 재생성되므로 사실상 "초기화"다.
   */
  @Delete("{missionId}/playbook")
  @Security("bearerAuth")
  @Middlewares(authorizeUser())
  @SuccessResponse(200, "OK")
  @Response(401, "UNAUTHORIZED")
  @Response(404, "MISSION_NOT_FOUND")
  @Response(404, "PLAYBOOK_NOT_FOUND")
  public async deletePlaybook(@Path() missionId: string): Promise<ApiResponse<null>> {
    await playbookAdmin.deletePlaybook(missionId);
    return success(null, "플레이북이 삭제되었습니다. 다음 대화 시작 시 다시 생성됩니다.");
  }
}
