import { z } from "zod";

// step별 필수 필드(personalityType/difficultSituations/purpose)는 step 값에 따라 달라지므로
// 여기서는 형식만 느슨하게 검증하고, step-필드 조합 검증은 onboarding.service.ts에서 수행한다
// (CONVENTION.md `## 3.4` — 미들웨어는 형식, 서비스는 비즈니스 규칙).
export interface OnboardingStepRequestDto {
  step: number;
  personalityType?: "introvert" | "extrovert" | "ambivert";
  difficultSituations?: string[];
  purpose?: string[];
}

export const onboardingStepRequestSchema = z.object({
  step: z.number().int(),
  personalityType: z.enum(["introvert", "extrovert", "ambivert"]).optional(),
  difficultSituations: z.array(z.string()).max(2, "어려운 상황은 최대 2개까지 선택할 수 있습니다").optional(),
  purpose: z.array(z.string()).max(2, "연습하고 싶은 대화 유형은 최대 2개까지 선택할 수 있습니다").optional(),
}) satisfies z.ZodType<OnboardingStepRequestDto>;

export interface OnboardingStepResponseDto {
  step: number;
  onboardingCompleted: boolean;
}

export interface OnboardingCompleteResponseDto {
  onboardingCompleted: boolean;
}
