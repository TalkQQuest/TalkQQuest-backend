import { findSettingsByUserId, updateSettings } from "../repositories/settings.repository";
import { SettingsResponseDto, UpdateSettingsRequestDto } from "../dtos/settings.dto";
import { AppError } from "../../../shared/errors/app-error";

export const getSettings = async (userId: string): Promise<SettingsResponseDto> => {
    const settings = await findSettingsByUserId(userId);
    if (!settings) {
        throw new AppError("NOT_FOUND", 404, "알림 설정을 찾을 수 없습니다.");
    }

    return {
        missionReminder: settings.mission_reminder,
        missionReminderTime: settings.mission_reminder_time,
        communityApproved: settings.community_approved,
        reportReady: settings.report_ready,
        marketing: settings.marketing,
    };
    };

    export const updateSettingsService = async (
    userId: string,
    dto: UpdateSettingsRequestDto
    ): Promise<null> => {
    const settings = await findSettingsByUserId(userId);
    if (!settings) {
        throw new AppError("NOT_FOUND", 404, "알림 설정을 찾을 수 없습니다.");
    }

    await updateSettings(userId, {
        ...(dto.missionReminder !== undefined && { mission_reminder: dto.missionReminder }),
        ...(dto.missionReminderTime !== undefined && { mission_reminder_time: dto.missionReminderTime }),
        ...(dto.communityApproved !== undefined && { community_approved: dto.communityApproved }),
        ...(dto.reportReady !== undefined && { report_ready: dto.reportReady }),
        ...(dto.marketing !== undefined && { marketing: dto.marketing }),
    });

    return null;
};