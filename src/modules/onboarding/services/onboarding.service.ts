import { DuplicatedError, NotFoundError, ValidationError } from "../../../shared/errors/common.error";
import { IncompleteOnboardingError, InvalidStepError } from "../errors/onboarding.error";
import * as userRepository from "../../user/repositories/user.repository";
import * as onboardingRepository from "../repositories/onboarding.repository";
import { DIFFICULT_SITUATIONS, DifficultSituation } from "../dtos/onboarding.constants";
import {
  OnboardingCompleteResponseDto,
  OnboardingStepRequestDto,
  OnboardingStepResponseDto,
} from "../dtos/onboarding.dto";

// difficultSituations 중 고정 선택지(DIFFICULT_SITUATIONS)에 없는 값은 직접 입력으로 본다.
const isCustomSituation = (value: string): boolean =>
  !DIFFICULT_SITUATIONS.includes(value as DifficultSituation);

export const saveOnboardingStep = async (
  userId: string,
  body: OnboardingStepRequestDto
): Promise<OnboardingStepResponseDto> => {
  const profile = await userRepository.findProfileByUserId(userId);
  if (!profile) {
    throw new NotFoundError("사용자를 찾을 수 없습니다.");
  }

  switch (body.step) {
    case 1:
      if (!body.personalityType) {
        throw new ValidationError("personalityType이 필요합니다.");
      }
      await onboardingRepository.saveOnboardingStepData(userId, 1, {
        personality_type: body.personalityType,
      });
      break;
    case 2:
      if (!body.difficultSituations || body.difficultSituations.length === 0) {
        throw new ValidationError("difficultSituations가 필요합니다.");
      }
      if (body.difficultSituations.filter(isCustomSituation).length > 1) {
        throw new ValidationError("직접 입력은 1개까지만 가능합니다.");
      }
      await onboardingRepository.saveOnboardingStepData(userId, 2, {
        difficult_situations: body.difficultSituations,
      });
      break;
    case 3:
      if (!body.purpose || body.purpose.length === 0) {
        throw new ValidationError("purpose가 필요합니다.");
      }
      await onboardingRepository.saveOnboardingStepData(userId, 3, {
        purpose: body.purpose,
      });
      break;
    default:
      throw new InvalidStepError();
  }

  return { step: body.step, onboardingCompleted: profile.onboarding_completed };
};

export const completeOnboarding = async (userId: string): Promise<OnboardingCompleteResponseDto> => {
  const profile = await userRepository.findProfileByUserId(userId);
  if (!profile) {
    throw new NotFoundError("사용자를 찾을 수 없습니다.");
  }
  if (profile.onboarding_completed) {
    throw new DuplicatedError("이미 온보딩이 완료된 계정입니다.");
  }
  if (profile.onboarding_step < 3) {
    throw new IncompleteOnboardingError();
  }

  await onboardingRepository.completeOnboarding(userId);
  return { onboardingCompleted: true };
};
