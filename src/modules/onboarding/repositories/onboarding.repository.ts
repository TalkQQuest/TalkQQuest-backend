import { Prisma } from "@prisma/client";
import { prisma } from "../../../config/database";

export const saveOnboardingStepData = (
  userId: string,
  step: number,
  data: Prisma.User_ProfilesUpdateInput
) =>
  prisma.user_Profiles.update({
    where: { user_id: userId },
    data: { ...data, onboarding_step: step },
  });

export const completeOnboarding = (userId: string) =>
  prisma.user_Profiles.update({
    where: { user_id: userId },
    data: { onboarding_completed: true },
  });
