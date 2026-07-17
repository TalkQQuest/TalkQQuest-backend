import { z } from "zod";

// 설정 조회 응답
export interface SettingsResponseDto {
    missionReminder: boolean;
    communityApproved: boolean;
    reportReady: boolean;
    marketing: boolean;
}

// tsoa용 명시적 인터페이스
export interface UpdateSettingsRequestDto {
    missionReminder?: boolean;
    communityApproved?: boolean;
    reportReady?: boolean;
    marketing?: boolean;
}

// Zod 검증용 스키마
export const updateSettingsRequestSchema = z.object({
    missionReminder: z.boolean().optional(),
    communityApproved: z.boolean().optional(),
    reportReady: z.boolean().optional(),
    marketing: z.boolean().optional(),
});