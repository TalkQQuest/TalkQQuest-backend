import { z } from "zod";

export type MissionCompletionResult = "success" | "failure" | "avoidance";

export interface CompleteConversationRequestDto {
  conversationId: string;
  result: MissionCompletionResult;
  memo?: string;
  durationMinutes: number;
  emotion?: string;
}

export const completeConversationRequestSchema = z.object({
  conversationId: z.string().uuid(),
  result: z.enum(["success", "failure", "avoidance"]),
  memo: z.string().optional(),
  durationMinutes: z.number().int().positive(),
  emotion: z.string().max(50).optional(),
}) satisfies z.ZodType<CompleteConversationRequestDto>;

export interface CompleteConversationResponseDto {
  missionRecordId: string;
  status: "completed";
  xpEarned: number;
  completedAt: string;
}