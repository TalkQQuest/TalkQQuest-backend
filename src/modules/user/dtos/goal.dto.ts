import { z } from "zod";

export interface GoalDto {
  id: string;
  goalType: string;
  target: string;
  isActive: boolean;
  createdAt: string;
}

export interface GoalListResponseDto {
  goals: GoalDto[];
}

export interface CreateGoalRequestDto {
  goalType: string;
  target: string;
}

export const createGoalRequestSchema = z.object({
  goalType: z.string().min(1, "goalType이 필요합니다").max(50),
  target: z.string().min(1, "target이 필요합니다").max(255),
}) satisfies z.ZodType<CreateGoalRequestDto>;

export interface CreateGoalResponseDto {
  goalId: string;
}

export interface UpdateGoalRequestDto {
  target?: string;
  isActive?: boolean;
}

export const updateGoalRequestSchema = z.object({
  target: z.string().min(1).max(255).optional(),
  isActive: z.boolean().optional(),
}) satisfies z.ZodType<UpdateGoalRequestDto>;
