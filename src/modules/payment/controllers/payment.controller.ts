import { Body, Controller, Get, Middlewares, Post, Request, Response, Route, Security, Tags } from "tsoa";
import type { Request as ExpressRequest } from "express";
import { authorizeUser } from "../../../middlewares/auth";
import { validate } from "../../../middlewares/validator";
import { success, ApiResponse } from "../../../shared/utils/response";
import {
  CreatePaymentRequestDto,
  CreatePaymentResponseDto,
  PaymentListResponseDto,
  createPaymentRequestSchema,
} from "../dtos/payment.dto";
import * as paymentService from "../services/payment.service";

@Route("payments")
@Tags("Payment")
export class PaymentController extends Controller {
  /**
   * @summary 결제 요청
   */
  @Post()
  @Security("bearerAuth")
  @Middlewares(authorizeUser(), validate(createPaymentRequestSchema))
  @Response(400, "VALIDATION_ERROR")
  @Response(401, "UNAUTHORIZED")
  @Response(402, "PAYMENT_FAILED")
  public async requestPayment(
    @Request() req: ExpressRequest,
    @Body() body: CreatePaymentRequestDto
  ): Promise<ApiResponse<CreatePaymentResponseDto>> {
    const result = await paymentService.requestPayment(req.user!.id, body);
    return success(result, "결제가 완료되었습니다.");
  }

  /**
   * @summary 결제 내역 조회
   */
  @Get("me")
  @Security("bearerAuth")
  @Middlewares(authorizeUser())
  @Response(401, "UNAUTHORIZED")
  public async getMyPayments(@Request() req: ExpressRequest): Promise<ApiResponse<PaymentListResponseDto>> {
    const result = await paymentService.getMyPayments(req.user!.id);
    return success(result);
  }
}
