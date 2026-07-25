import { Controller, Get, Route, Tags } from "tsoa";
import { success, ApiResponse } from "../../../shared/utils/response";
import { PlanListResponseDto } from "../dtos/plan.dto";
import { getActivePlans } from "../services/plan.service";

@Route("plans")
@Tags("Payment")
export class PlanController extends Controller {
  /**
   * @summary 플랜 목록 조회
   */
  @Get()
  public async getPlans(): Promise<ApiResponse<PlanListResponseDto>> {
    const result = await getActivePlans();
    return success(result);
  }
}
