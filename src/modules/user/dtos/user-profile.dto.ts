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
  /** 온보딩 1단계(평소 대화할 때의 모습)에서 선택한 값. 온보딩 전이면 null(#190). */
  personalityType: "introvert" | "extrovert" | "ambivert" | null;
  /** 온보딩 2단계(대화에서 가장 어려운 점)에서 선택한 값. 온보딩 전이면 빈 배열(#190). */
  difficultSituations: string[];
  /** 온보딩 3단계(연습하고 싶은 대화)에서 선택한 값. 온보딩 전이면 빈 배열(#190). */
  purpose: string[];
  /** 선호하는 대화 스타일. PATCH /users/me로 수정 가능(#190). */
  preferredStyle: string | null;
  /** 관심사. PATCH /users/me로 수정 가능(#190). */
  interests: string[];
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
