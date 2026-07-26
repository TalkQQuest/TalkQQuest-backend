import { z } from "zod";
import { DIFFICULT_SITUATIONS, PRACTICE_PURPOSES, PracticePurpose } from "./onboarding.constants";

// step별 필수 필드(personalityType/difficultSituations/purpose)는 step 값에 따라 달라지므로
// 여기서는 형식만 느슨하게 검증하고, step-필드 조합 검증 및 difficultSituations의
// "직접 입력은 1개까지" 규칙은 onboarding.service.ts에서 수행한다
// (CONVENTION.md `## 3.4` — 미들웨어는 형식, 서비스는 비즈니스 규칙).
export interface OnboardingStepRequestDto {
  /** @example 2 */
  step: number;
  /**
   * step 1(평소 대화할 때의 모습)에서만 사용한다.
   * 가능한 값: introvert(조용하고 신중해요) / extrovert(사교적이고 활발한 편이에요) / ambivert(상황에 따라 달라요)
   * @example "introvert"
   */
  personalityType?: "introvert" | "extrovert" | "ambivert";
  /**
   * step 2(대화에서 가장 어려운 점)에서만 사용한다. 최대 2개, 그중 1개까지는 아래 목록에 없는 직접 입력 문자열 허용.
   * 가능한 값(DIFFICULT_SITUATIONS): 낯가림 / 주제고민 / 말문 막힘 / 시선 부담 / 긴장됨 / 걱정·불안 / 상대 파악 어려움 / 어색함
   * (custom 입력을 허용하므로 string[]로 두고, 고정 선택지 검증은 zod에서 한다.)
   * @example ["낯가림", "직접 입력한 어려운 점"]
   */
  difficultSituations?: string[];
  /**
   * step 3(연습하고 싶은 대화)에서만 사용한다. 최대 2개, 직접 입력은 불가하다.
   * 가능한 값(PRACTICE_PURPOSES): 자신감 키우기 / 말문 트기 / 침묵 줄이기 / 자연스럽게 말하기 / 상황에 맞는 대화 / 친해지는 대화 / 첫인상 개선하기
   * 직접 입력이 없는 고정 선택지라 union 타입으로 두면 tsoa가 swagger에 enum을 반영한다.
   * @example ["자신감 키우기", "말문 트기"]
   */
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
  /** @example 2 */
  step: number;
  /** @example false */
  onboardingCompleted: boolean;
}

export interface OnboardingCompleteResponseDto {
  /** @example true */
  onboardingCompleted: boolean;
}

export { DIFFICULT_SITUATIONS, PRACTICE_PURPOSES };
