export interface UsageResponseDto {
  cycleStart: string;
  cycleEnd: string;
  aiCount: number;
  feedbackCount: number;
  aiLimit: number | null;
  feedbackLimit: number | null;
}
