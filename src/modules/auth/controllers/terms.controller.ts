import { Controller, Get, Query, Route, Tags } from "tsoa";
import { success, ApiResponse } from "../../../shared/utils/response";
import { TermsDto } from "../dtos/terms.dto";
import { getLatestTerms } from "../services/terms.service";

@Route("terms")
@Tags("Auth")
export class TermsController extends Controller {
  /**
   * @summary 최신 약관/개인정보 조회
   */
  @Get("latest")
  public async latest(@Query() type: "terms" | "privacy" = "terms"): Promise<ApiResponse<TermsDto>> {
    const result = await getLatestTerms(type);
    return success(result);
  }
}
