import { z } from "zod";

// design.md `#### POST /auth/refresh` 참고.
export interface RefreshRequestDto {
  refreshToken: string;
}

export interface RefreshResponseDto {
  accessToken: string;
}

export interface LogoutRequestDto {
  refreshToken: string;
}

export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(1, "refreshToken이 필요합니다"),
}) satisfies z.ZodType<RefreshRequestDto>;

export const logoutRequestSchema = z.object({
  refreshToken: z.string().min(1, "refreshToken이 필요합니다"),
}) satisfies z.ZodType<LogoutRequestDto>;
