import { Controller, Get, Response, Route, Tags } from "tsoa";
import { success, ApiResponse } from "../../../shared/utils/response";
import { TermsDto } from "../dtos/terms.dto";
import { getLatestTerms } from "../services/terms.service";

@Route("legal")
@Tags("Auth")
export class TermsController extends Controller {
  /**
   * @summary 이용약관 조회
   */
  @Get("terms")
  @Response(404, "NOT_FOUND")
  public async terms(): Promise<ApiResponse<TermsDto>> {
    const result = await getLatestTerms("terms");
    return success(result);
  }

  /**
   * @summary 개인정보처리방침 조회
   */
  @Get("privacy")
  @Response(404, "NOT_FOUND")
  public async privacy(): Promise<ApiResponse<TermsDto>> {
    const result = await getLatestTerms("privacy");
    return success(result);
  }
}
