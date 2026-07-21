import { findActivePlans } from "../repositories/plan.repository";
import { PlanListResponseDto } from "../dtos/plan.dto";

export const getActivePlans = async (): Promise<PlanListResponseDto> => {
  const plans = await findActivePlans();

  return {
    plans: plans.map((plan) => ({
      id: plan.id,
      name: plan.name,
      price: Number(plan.price),
      currency: plan.currency,
      aiLimit: plan.ai_limit,
      feedbackLimit: plan.feedback_limit,
      features: (plan.features as string[] | null) ?? [],
    })),
  };
};
