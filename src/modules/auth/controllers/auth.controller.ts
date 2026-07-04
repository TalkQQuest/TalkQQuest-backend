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
import {
  EmailAuthResponseDto,
  EmailRequestDto,
  EmailVerifyDto,
  LoginRequestDto,
  SignupRequestDto,
  emailRequestSchema,
  emailVerifySchema,
  loginRequestSchema,
  signupRequestSchema,
} from "../dtos/email-auth.dto";
import { loginWithKakao, loginWithNaver } from "../services/oauth.service";
import { logout, refreshAccessToken } from "../services/token.service";
import { requestEmailVerification, verifyEmailCode } from "../services/email-verification.service";
import { loginWithEmail, signupWithEmail } from "../services/email-auth.service";

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

  /**
   * @summary 이메일 인증번호 발송
   */
  @Post("email/request")
  @Middlewares(validate(emailRequestSchema))
  public async emailRequest(@Body() body: EmailRequestDto): Promise<ApiResponse<null>> {
    await requestEmailVerification(body.email);
    return success(null, "인증번호를 발송했습니다");
  }

  /**
   * @summary 이메일 인증번호 확인
   */
  @Post("email/verify")
  @Middlewares(validate(emailVerifySchema))
  public async emailVerify(@Body() body: EmailVerifyDto): Promise<ApiResponse<null>> {
    await verifyEmailCode(body.email, body.code);
    return success(null, "이메일 인증이 완료되었습니다");
  }

  /**
   * @summary 이메일 회원가입
   */
  @Post("signup")
  @Middlewares(validate(signupRequestSchema))
  public async signup(@Body() body: SignupRequestDto): Promise<ApiResponse<EmailAuthResponseDto>> {
    const result = await signupWithEmail(body);
    return success(result, "회원가입이 완료되었습니다");
  }

  /**
   * @summary 이메일 로그인
   */
  @Post("login")
  @Middlewares(validate(loginRequestSchema))
  public async login(@Body() body: LoginRequestDto): Promise<ApiResponse<EmailAuthResponseDto>> {
    const result = await loginWithEmail(body);
    return success(result);
  }
}
