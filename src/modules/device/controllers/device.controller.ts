import { Body, Controller, Middlewares, Post, Request, Response, Route, Security, Tags } from "tsoa";
import type { Request as ExpressRequest } from "express";
import { authorizeUser } from "../../../middlewares/auth";
import { validate } from "../../../middlewares/validator";
import { success, ApiResponse } from "../../../shared/utils/response";
import {
  RegisterFcmTokenRequestDto,
  registerFcmTokenRequestSchema,
  RegisterFcmTokenResponseDto,
} from "../dtos/device.dto";
import * as deviceService from "../services/device.service";

@Route("devices")
@Tags("Device")
export class DeviceController extends Controller {
  /**
   * @summary FCM 토큰 등록/갱신
   *
   * 로그인 시점뿐 아니라 앱이 새 토큰을 받을 때(onNewToken)마다, 그리고 앱 실행 시마다
   * 호출한다. 같은 토큰으로 재요청하면 갱신만 하고 중복 등록되지 않는다.
   */
  @Post("fcm-token")
  @Security("bearerAuth")
  @Middlewares(authorizeUser(), validate(registerFcmTokenRequestSchema))
  @Response(400, "VALIDATION_ERROR")
  @Response(401, "UNAUTHORIZED")
  public async registerFcmToken(
    @Request() req: ExpressRequest,
    @Body() body: RegisterFcmTokenRequestDto
  ): Promise<ApiResponse<RegisterFcmTokenResponseDto>> {
    const result = await deviceService.registerFcmToken(req.user!.id, body);
    return success(result, "기기 토큰이 등록되었습니다.");
  }
}
