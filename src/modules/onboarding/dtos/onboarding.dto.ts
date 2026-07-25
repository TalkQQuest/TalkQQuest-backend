import { z } from "zod";
import { DIFFICULT_SITUATIONS, PRACTICE_PURPOSES, PracticePurpose } from "./onboarding.constants";

// step별 필수 필드(personalityType/difficultSituations/purpose)는 step 값에 따라 달라지므로
// 여기서는 형식만 느슨하게 검증하고, step-필드 조합 검증 및 difficultSituations의
// "직접 입력은 1개까지" 규칙은 onboarding.service.ts에서 수행한다
// (CONVENTION.md `## 3.4` — 미들웨어는 형식, 서비스는 비즈니스 규칙).
export interface OnboardingStepRequestDto {
  step: number;
  personalityType?: "introvert" | "extrovert" | "ambivert";
  // 고정 선택지(DIFFICULT_SITUATIONS) 중 최대 2개 + 그중 1개까지는 직접 입력한 문자열일 수 있다.
  // (custom 입력을 허용하므로 string[]로 두고, 고정 선택지 검증은 zod에서 한다.)
  difficultSituations?: string[];
  // 직접 입력이 없는 고정 선택지라 union 타입으로 두면 tsoa가 swagger에 enum을 반영한다.
  purpose?: PracticePurpose[];
}

export const onboardingStepRequestSchema = z.object({
  step: z.number().int(),
  personalityType: z.enum(["introvert", "extrovert", "ambivert"]).optional(),
  difficultSituations: z
    .array(z.string().trim().min(1).max(20))
    .max(2, "어려운 상황은 최대 2개까지 선택할 수 있습니다")
    .optional(),
  purpose: z
    .array(z.enum(PRACTICE_PURPOSES))
    .max(2, "연습하고 싶은 대화 유형은 최대 2개까지 선택할 수 있습니다")
    .optional(),
}) satisfies z.ZodType<OnboardingStepRequestDto>;

export interface OnboardingStepResponseDto {
  step: number;
  onboardingCompleted: boolean;
}

export interface OnboardingCompleteResponseDto {
  onboardingCompleted: boolean;
}

export { DIFFICULT_SITUATIONS, PRACTICE_PURPOSES };
