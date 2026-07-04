import { z } from "zod";

export interface MyProfileResponseDto {
  id: string;
  name: string;
  nickname: string | null;
  avatarUrl: string | null;
  bio: string | null;
  level: number;
  xp: number;
  dailyConversationGoal: number;
  onboardingCompleted: boolean;
}

export interface UpdateProfileRequestDto {
  nickname?: string;
  avatarUrl?: string;
  bio?: string;
  dailyConversationGoal?: number;
  preferredStyle?: string;
  interests?: string[];
}

export const updateProfileRequestSchema = z.object({
  nickname: z.string().min(1, "닉네임이 필요합니다").max(50).optional(),
  avatarUrl: z.string().url("올바른 URL 형식이 아닙니다").max(500).optional(),
  bio: z.string().optional(),
  dailyConversationGoal: z.number().int().positive().optional(),
  preferredStyle: z.string().max(255).optional(),
  interests: z.array(z.string()).optional(),
}) satisfies z.ZodType<UpdateProfileRequestDto>;
