import "dotenv/config";
import { z } from "zod";

// 서버 구동에 필요한 환경 변수를 한 곳에서 검증합니다.
// .env 가 없거나 필수 값이 비어 있으면 부팅 시점에 바로 에러를 던집니다.
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL이 필요합니다"),
  REDIS_URL: z.string().min(1, "REDIS_URL이 필요합니다"),
  JWT_ACCESS_SECRET: z.string().min(1),
  JWT_REFRESH_SECRET: z.string().min(1),
  JWT_ACCESS_EXPIRES_IN: z.string().default("1h"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("14d"),
  // 이메일 발송(Resend). 값이 없으면 실제 발송 없이 로그로만 인증번호를 출력한다
  // (팀원들이 각자 API 키를 세팅하지 않아도 로컬 개발/테스트가 가능하도록).
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().default("onboarding@resend.dev"),
  // 미션 추천 LLM(Upstage Solar, OpenAI 호환). 키가 없으면 LLM 호출을 건너뛰고
  // 규칙 기반 템플릿 추천(3단계)으로 폴백한다 — 키 없이도 로컬 개발/테스트가 동작.
  UPSTAGE_API_KEY: z.string().optional(),
  UPSTAGE_BASE_URL: z.string().default("https://api.upstage.ai/v1"),
  UPSTAGE_MODEL: z.string().default("solar-pro"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // logger는 env 검증 통과를 전제로 만들어지므로(config/logger.ts) 여기서는 console을 그대로 사용합니다.
  console.error("환경 변수 검증 실패:", parsed.error.flatten().fieldErrors);
  throw new Error("환경 변수가 올바르게 설정되지 않았습니다. .env.example을 참고하세요.");
}

export const env = parsed.data;
