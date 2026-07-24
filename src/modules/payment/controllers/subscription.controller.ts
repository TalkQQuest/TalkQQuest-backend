import { Body, Controller, Delete, Get, Middlewares, Post, Request, Response, Route, Security, Tags } from "tsoa";
import type { Request as ExpressRequest } from "express";
import { authorizeUser } from "../../../middlewares/auth";
import { validate } from "../../../middlewares/validator";
import { success, ApiResponse } from "../../../shared/utils/response";
import {
  CreateSubscriptionRequestDto,
  CreateSubscriptionResponseDto,
  MySubscriptionResponseDto,
  createSubscriptionRequestSchema,
} from "../dtos/subscription.dto";
import * as subscriptionService from "../services/subscription.service";

@Route("subscriptions")
@Tags("Payment")
export class SubscriptionController extends Controller {
  /**
   * @summary 구독 시작
   */
  @Post()
  @Security("bearerAuth")
  @Middlewares(authorizeUser(), validate(createSubscriptionRequestSchema))
  @Response(400, "VALIDATION_ERROR")
  @Response(401, "UNAUTHORIZED")
  @Response(409, "DUPLICATED")
  public async startSubscription(
    @Request() req: ExpressRequest,
    @Body() body: CreateSubscriptionRequestDto
  ): Promise<ApiResponse<CreateSubscriptionResponseDto>> {
    const result = await subscriptionService.startSubscription(req.user!.id, body);
    return success(result, "구독이 시작되었습니다.");
  }

  /**
   * @summary 내 구독 정보 조회
   */
  @Get("me")
  @Security("bearerAuth")
  @Middlewares(authorizeUser())
  @Response(401, "UNAUTHORIZED")
  @Response(404, "NOT_FOUND")
  public async getMySubscription(@Request() req: ExpressRequest): Promise<ApiResponse<MySubscriptionResponseDto>> {
    const result = await subscriptionService.getMySubscription(req.user!.id);
    return success(result);
  }

  /**
   * @summary 구독 취소
   */
  @Delete("me")
  @Security("bearerAuth")
  @Middlewares(authorizeUser())
  @Response(401, "UNAUTHORIZED")
  @Response(404, "NOT_FOUND")
  public async cancelMySubscription(@Request() req: ExpressRequest): Promise<ApiResponse<null>> {
    await subscriptionService.cancelMySubscription(req.user!.id);
    return success(null, "구독이 취소되었습니다.");
  }
}
