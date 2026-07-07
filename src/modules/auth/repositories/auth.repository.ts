import { Prisma, Provider } from "@prisma/client";
import { prisma } from "../../../config/database";

export const findIdentityByProvider = (provider: Provider, providerUserId: string) =>
  prisma.auth_Identities.findFirst({
    where: { provider, provider_user_id: providerUserId },
    include: { user: { include: { user_profile: true } } },
  });

export const findIdentityByProviderAndEmail = (provider: Provider, email: string) =>
  prisma.auth_Identities.findFirst({
    where: { provider, email },
    include: { user: { include: { user_profile: true } } },
  });

export const createUserWithIdentity = (
  provider: Provider,
  providerUserId: string,
  email: string | null
) =>
  prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const user = await tx.users.create({
      data: {
        // 소셜 로그인만으로는 이름/생년월일/학교·직업을 받을 수 없어 온보딩에서 채운다.
        name: "",
        school_or_job: "",
        birth_date: "",
      },
    });

    const identity = await tx.auth_Identities.create({
      data: {
        user_id: user.id,
        provider,
        provider_user_id: providerUserId,
        email,
      },
    });

    await tx.user_Profiles.create({ data: { user_id: user.id } });

    return { user, identity };
  });

export const createUserWithEmailIdentity = (params: {
  email: string;
  passwordHash: string;
  name: string;
  birthDate: string;
  schoolOrJob: string;
  termsAgreedAt: Date;
}) =>
  prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const user = await tx.users.create({
      data: {
        name: params.name,
        birth_date: params.birthDate,
        school_or_job: params.schoolOrJob,
        terms_agreed_at: params.termsAgreedAt,
      },
    });

    const identity = await tx.auth_Identities.create({
      data: {
        user_id: user.id,
        provider: "email",
        email: params.email,
        password_hash: params.passwordHash,
      },
    });

    await tx.user_Profiles.create({ data: { user_id: user.id } });

    return { user, identity };
  });

export const findLatestActiveTerms = (type: "terms" | "privacy") =>
  prisma.terms.findFirst({
    where: { type, is_active: true },
    orderBy: { created_at: "desc" },
  });

export const createRefreshToken = (
  userId: string,
  token: string,
  expiresAt: Date,
  deviceInfo?: unknown
) =>
  prisma.refresh_Tokens.create({
    data: {
      user_id: userId,
      token,
      expires_at: expiresAt,
      device_info: deviceInfo as Prisma.InputJsonValue | undefined,
    },
  });

export const touchLastLogin = (userId: string) =>
  prisma.users.update({ where: { id: userId }, data: { last_login_at: new Date() } });

export const findAnyIdentityEmailByUserId = async (userId: string): Promise<string | null> => {
  const identity = await prisma.auth_Identities.findFirst({
    where: { user_id: userId, email: { not: null } },
  });
  return identity?.email ?? null;
};

export const findActiveRefreshToken = (token: string) =>
  prisma.refresh_Tokens.findFirst({
    where: { token, revoked: false, expires_at: { gt: new Date() } },
  });

export const revokeRefreshToken = (token: string) =>
  prisma.refresh_Tokens.updateMany({ where: { token }, data: { revoked: true } });
