import * as userRepository from "../repositories/user.repository";
import { getUsageContext } from "../../payment/services/subscription.service";
import { addMonths, getCurrentCycleStart } from "../../../shared/utils/date";
import { NotFoundError } from "../../../shared/errors/common.error";
import { UsageResponseDto } from "../dtos/usage.dto";

export const getMyUsage = async (userId: string): Promise<UsageResponseDto> => {
  const createdAt = await userRepository.findUserCreatedAt(userId);
  if (!createdAt) {
    throw new NotFoundError("사용자를 찾을 수 없습니다.");
  }

  const { plan, cycleAnchor } = await getUsageContext(userId, createdAt);
  const cycleStart = getCurrentCycleStart(cycleAnchor);
  const cycleEnd = addMonths(cycleStart, 1);

  const usage = await userRepository.findUsageByUserAndCycleStart(userId, cycleStart);

  return {
    cycleStart: cycleStart.toISOString(),
    cycleEnd: cycleEnd.toISOString(),
    aiCount: usage?.ai_count ?? 0,
    feedbackCount: usage?.feedback_count ?? 0,
    aiLimit: plan.ai_limit,
    feedbackLimit: plan.feedback_limit,
  };
};
