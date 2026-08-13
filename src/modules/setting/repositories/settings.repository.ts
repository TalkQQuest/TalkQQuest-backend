import { prisma } from "../../../config/database";

// 스칼라 값만 다룬다 — Prisma.Notification_SettingsUpdateInput은 관계 필드(user)까지
// 포함돼 있어 create에 그대로 스프레드할 수 없다.
export interface NotificationSettingsPatch {
    mission_reminder?: boolean;
    mission_reminder_time?: string;
    community_approved?: boolean;
    report_ready?: boolean;
    marketing?: boolean;
}

export const findSettingsByUserId = (userId: string) =>
    prisma.notification_Settings.findUnique({ where: { user_id: userId } });

// 회원가입 시점에 Notification_Settings 행을 만들어주는 경로가 없어(#215), 조회/수정 시점에
// 없으면 스키마 기본값으로 즉시 생성한다. upsert의 update는 빈 객체를 넘기면 no-op이라
// "조회"에도 안전하게 재사용할 수 있다 — 기존 가입자도 처음 호출하는 순간 자동으로 채워진다.
export const upsertSettings = (
    userId: string,
    data: NotificationSettingsPatch
    ) =>
    prisma.notification_Settings.upsert({
        where: { user_id: userId },
        create: { user_id: userId, ...data },
        update: data,
});