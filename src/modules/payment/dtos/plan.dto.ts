export interface PlanDto {
  id: string;
  name: string;
  price: number;
  currency: string;
  aiLimit: number | null;
  feedbackLimit: number | null;
  features: string[];
}

export interface PlanListResponseDto {
  plans: PlanDto[];
}
