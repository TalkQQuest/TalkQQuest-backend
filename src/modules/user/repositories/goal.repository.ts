import { Prisma } from "@prisma/client";
import { prisma } from "../../../config/database";

export const findGoalsByUserId = (userId: string) =>
  prisma.goals.findMany({
    where: { user_id: userId },
    orderBy: { created_at: "desc" },
  });

export const findGoalByIdAndUserId = (id: string, userId: string) =>
  prisma.goals.findFirst({ where: { id, user_id: userId } });

export const createGoal = (userId: string, data: { goal_type: string; target: string }) =>
  prisma.goals.create({
    data: { user_id: userId, goal_type: data.goal_type, target: data.target },
  });

export const updateGoal = (id: string, data: Prisma.GoalsUpdateInput) =>
  prisma.goals.update({ where: { id }, data });

export const deleteGoal = (id: string) => prisma.goals.delete({ where: { id } });
