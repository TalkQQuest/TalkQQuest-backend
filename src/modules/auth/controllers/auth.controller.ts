import { Body, Controller, Middlewares, Post, Route, Tags } from "tsoa";
import { validate } from "../../../middlewares/validator";
import { success, ApiResponse } from "../../../shared/utils/response";
import { OAuthLoginRequestDto, OAuthLoginResponseDto, oauthLoginRequestSchema } from "../dtos/oauth.dto";
import {
  LogoutRequestDto,
  RefreshRequestDto,
  RefreshResponseDto,
  logoutRequestSchema,
  refreshRequestSchema,
} from "../dtos/token.dto";
import { loginWithKakao, loginWithNaver } from "../services/oauth.service";
import { logout, refreshAccessToken } from "../services/token.service";

@Route("auth")
@Tags("Auth")
export class AuthController extends Controller {
  /**
   * @summary 카카오 로그인
   */
  @Post("oauth/kakao")
  @Middlewares(validate(oauthLoginRequestSchema))
  public async oauthKakao(
    @Body() body: OAuthLoginRequestDto
  ): Promise<ApiResponse<OAuthLoginResponseDto>> {
    const result = await loginWithKakao(body);
    return success(result);
  }

  /**
   * @summary 네이버 로그인
   */
  @Post("oauth/naver")
  @Middlewares(validate(oauthLoginRequestSchema))
  public async oauthNaver(
    @Body() body: OAuthLoginRequestDto
  ): Promise<ApiResponse<OAuthLoginResponseDto>> {
    const result = await loginWithNaver(body);
    return success(result);
  }

  /**
   * @summary Access Token 재발급
   */
  @Post("refresh")
  @Middlewares(validate(refreshRequestSchema))
  public async refresh(@Body() body: RefreshRequestDto): Promise<ApiResponse<RefreshResponseDto>> {
    const result = await refreshAccessToken(body.refreshToken);
    return success(result);
  }

  /**
   * @summary 로그아웃
   */
  @Post("logout")
  @Middlewares(validate(logoutRequestSchema))
  public async logout(@Body() body: LogoutRequestDto): Promise<ApiResponse<null>> {
    await logout(body.refreshToken);
    return success(null, "로그아웃되었습니다");
  }
}
