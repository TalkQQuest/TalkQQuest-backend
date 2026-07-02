import { Controller, Get, Route, Tags } from "tsoa";
import { success, ApiResponse } from "../../../shared/utils/response";

interface HealthCheckResponse {
  status: "ok";
  timestamp: string;
}

@Route("health")
@Tags("Health")
export class HealthController extends Controller {
  /**
   * @summary 서버 헬스체크
   */
  @Get()
  public async check(): Promise<ApiResponse<HealthCheckResponse>> {
    return success({ status: "ok", timestamp: new Date().toISOString() });
  }
}
