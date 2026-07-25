import { DuplicatedError, NotFoundError, ValidationError } from "../../../shared/errors/common.error";
import { IncompleteOnboardingError, InvalidStepError } from "../errors/user.error";
import * as userRepository from "../repositories/user.repository";
import {
  OnboardingCompleteResponseDto,
  OnboardingStepRequestDto,
  OnboardingStepResponseDto,
} from "../dtos/onboarding.dto";

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
      await userRepository.saveOnboardingStepData(userId, 1, {
        personality_type: body.personalityType,
      });
      break;
    case 2:
      if (!body.difficultSituations || body.difficultSituations.length === 0) {
        throw new ValidationError("difficultSituations가 필요합니다.");
      }
      await userRepository.saveOnboardingStepData(userId, 2, {
        difficult_situations: body.difficultSituations,
      });
      break;
    case 3:
      if (!body.purpose || body.purpose.length === 0) {
        throw new ValidationError("purpose가 필요합니다.");
      }
      await userRepository.saveOnboardingStepData(userId, 3, {
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

  await userRepository.completeOnboarding(userId);
  return { onboardingCompleted: true };
};
