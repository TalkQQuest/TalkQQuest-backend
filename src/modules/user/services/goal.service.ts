import { Goals } from "@prisma/client";
import { NotFoundError } from "../../../shared/errors/common.error";
import * as goalRepository from "../repositories/goal.repository";
import {
  CreateGoalRequestDto,
  CreateGoalResponseDto,
  GoalDto,
  GoalListResponseDto,
  UpdateGoalRequestDto,
} from "../dtos/goal.dto";

const toGoalDto = (goal: Goals): GoalDto => ({
  id: goal.id,
  goalType: goal.goal_type,
  target: goal.target,
  isActive: goal.is_active,
  createdAt: goal.created_at.toISOString(),
});

export const getGoals = async (userId: string): Promise<GoalListResponseDto> => {
  const goals = await goalRepository.findGoalsByUserId(userId);
  return { goals: goals.map(toGoalDto) };
};

export const createGoal = async (
  userId: string,
  body: CreateGoalRequestDto
): Promise<CreateGoalResponseDto> => {
  const goal = await goalRepository.createGoal(userId, {
    goal_type: body.goalType,
    target: body.target,
  });
  return { goalId: goal.id };
};

export const updateGoal = async (
  userId: string,
  goalId: string,
  body: UpdateGoalRequestDto
): Promise<void> => {
  const goal = await goalRepository.findGoalByIdAndUserId(goalId, userId);
  if (!goal) {
    throw new NotFoundError("존재하지 않는 목표입니다.");
  }

  await goalRepository.updateGoal(goalId, {
    ...(body.target !== undefined && { target: body.target }),
    ...(body.isActive !== undefined && { is_active: body.isActive }),
  });
};

export const deleteGoal = async (userId: string, goalId: string): Promise<void> => {
  const goal = await goalRepository.findGoalByIdAndUserId(goalId, userId);
  if (!goal) {
    throw new NotFoundError("존재하지 않는 목표입니다.");
  }

  await goalRepository.deleteGoal(goalId);
};
