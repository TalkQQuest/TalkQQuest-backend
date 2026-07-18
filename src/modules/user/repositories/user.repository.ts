import { Prisma } from "@prisma/client";
import { prisma } from "../../../config/database";

export const findUserWithProfile = (userId: string) =>
  prisma.users.findUnique({
    where: { id: userId },
    include: { user_profile: true },
  });

export const findProfileByUserId = (userId: string) =>
  prisma.user_Profiles.findUnique({ where: { user_id: userId } });

export const updateProfile = (userId: string, data: Prisma.User_ProfilesUpdateInput) =>
  prisma.user_Profiles.update({ where: { user_id: userId }, data });

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

export const softDeleteUser = (userId: string) =>
  prisma.users.update({
    where: { id: userId },
    data: {
      status: "deleted",
      deleted_at: new Date(),
    },
  });