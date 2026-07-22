import { prisma } from "../../../config/database";

export const findActivePlans = () =>
  prisma.plans.findMany({
    where: { is_active: true },
    orderBy: { price: "asc" },
  });

export const findPlanById = (id: string) => prisma.plans.findUnique({ where: { id } });
