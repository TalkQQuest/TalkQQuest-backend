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
  // 임베딩(대화 상황 규칙 매칭용)은 비대칭 검색이라 저장용/질의용 모델이 나뉜다.
  // 같은 모델로 양쪽을 임베딩하면 유사도가 제대로 나오지 않는다.
  UPSTAGE_EMBEDDING_PASSAGE_MODEL: z.string().default("embedding-passage"),
  UPSTAGE_EMBEDDING_QUERY_MODEL: z.string().default("embedding-query"),
  // 푸시 발송(FCM, Firebase Admin SDK). 셋 다 없으면 발송 없이 로그만 남긴다
  // (RESEND_API_KEY와 같은 패턴 — 키 없이도 로컬 개발/테스트가 동작).
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),
}).superRefine((data, ctx) => {
  // 셋 다 비어 있으면 정상(발송 기능 비활성). 하나라도 있으면 셋 다 있어야 한다 —
  // 부분 설정(오타 등으로 하나만 빠짐)이 "발송 비활성"으로 조용히 흡수되는 것을 막는다.
  const values = [data.FIREBASE_PROJECT_ID, data.FIREBASE_CLIENT_EMAIL, data.FIREBASE_PRIVATE_KEY];
  const presentCount = values.filter((v) => !!v).length;
  if (presentCount > 0 && presentCount < values.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY는 셋 다 설정하거나 셋 다 비워야 합니다",
      path: ["FIREBASE_PROJECT_ID"],
    });
  }
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // logger는 env 검증 통과를 전제로 만들어지므로(config/logger.ts) 여기서는 console을 그대로 사용합니다.
  console.error("환경 변수 검증 실패:", parsed.error.flatten().fieldErrors);
  throw new Error("환경 변수가 올바르게 설정되지 않았습니다. .env.example을 참고하세요.");
}

export const env = parsed.data;
