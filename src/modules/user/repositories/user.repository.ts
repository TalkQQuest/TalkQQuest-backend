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

// 탈퇴해도 Auth_Identities.email을 그대로 두면 (provider, email) unique 제약 때문에
// 같은 이메일로 재가입이 영구히 불가능해진다. userId는 가입마다 새로 발급되는 UUID라
// 같은 이메일로 가입→탈퇴를 여러 번 반복해도 이 값끼리는 절대 충돌하지 않는다.
const buildWithdrawnEmail = (userId: string) => `deleted_${userId}@withdrawn.local`;

export const softDeleteUser = (userId: string) =>
  prisma.$transaction([
    prisma.users.update({
      where: { id: userId },
      data: {
        status: "deleted",
        deleted_at: new Date(),
      },
    }),
    prisma.auth_Identities.updateMany({
      where: { user_id: userId },
      data: {
        email: buildWithdrawnEmail(userId),
        password_hash: null,
      },
    }),
  ]);

export const findUserCreatedAt = async (userId: string): Promise<Date | null> => {
  const user = await prisma.users.findUnique({ where: { id: userId }, select: { created_at: true } });
  return user?.created_at ?? null;
};

export const findUsageByUserAndCycleStart = (userId: string, cycleStart: Date) =>
  prisma.usage.findUnique({ where: { user_id_cycle_start: { user_id: userId, cycle_start: cycleStart } } });