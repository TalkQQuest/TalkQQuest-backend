import { upsertSettings } from "../repositories/settings.repository";
import { SettingsResponseDto, UpdateSettingsRequestDto } from "../dtos/settings.dto";

// #215 — 회원가입 시점에 Notification_Settings 행을 만들어주지 않아 모든 사용자가 404를
// 받고 있었다. 조회도 upsert로 처리해 없으면 스키마 기본값으로 즉시 생성한다(기존 가입자
// 포함, 별도 백필 없이 첫 호출에서 자동으로 해결된다).
export const getSettings = async (userId: string): Promise<SettingsResponseDto> => {
    const settings = await upsertSettings(userId, {});

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
    await upsertSettings(userId, {
        ...(dto.missionReminder !== undefined && { mission_reminder: dto.missionReminder }),
        ...(dto.missionReminderTime !== undefined && { mission_reminder_time: dto.missionReminderTime }),
        ...(dto.communityApproved !== undefined && { community_approved: dto.communityApproved }),
        ...(dto.reportReady !== undefined && { report_ready: dto.reportReady }),
        ...(dto.marketing !== undefined && { marketing: dto.marketing }),
    });

    return null;
};