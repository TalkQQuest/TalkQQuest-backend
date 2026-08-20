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

// 대화에서 추출된 관심사를 extracted_interests에 원자적으로 병합한다(#262). 온보딩에서
// 사용자가 직접 고른 interests와는 별도 컬럼이다 — 같은 필드에 섞으면 잡담 중 스친 키워드가
// 캡(maxCount)에 밀려 사용자가 신중하게 고른 값을 조용히 지워버릴 수 있다(리뷰 반영).
// 두 피드백이 동시에 완료돼도 read-modify-write 경쟁으로 한쪽이 유실되지 않도록, 같은 행을
// 잠근 트랜잭션 안에서 조회→병합→저장을 한 번에 처리한다.
export const mergeExtractedInterests = (
  userId: string,
  newInterests: string[],
  maxCount: number
): Promise<void> =>
  prisma.$transaction(async (tx) => {
    // FOR UPDATE로 이 트랜잭션이 끝날 때까지 다른 트랜잭션의 동시 읽기/쓰기를 막는다.
    const rows = await tx.$queryRaw<{ extracted_interests: unknown }[]>`
      SELECT extracted_interests FROM User_Profiles WHERE user_id = ${userId} FOR UPDATE
    `;
    if (rows.length === 0) return;

    const existing = Array.isArray(rows[0].extracted_interests)
      ? (rows[0].extracted_interests as unknown[]).filter((v): v is string => typeof v === "string")
      : [];
    const merged = [...new Set([...newInterests, ...existing])].slice(0, maxCount);

    await tx.user_Profiles.update({
      where: { user_id: userId },
      data: { extracted_interests: merged as unknown as Prisma.InputJsonValue },
    });
  });