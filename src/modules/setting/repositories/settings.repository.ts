import { Prisma } from "@prisma/client";
import { prisma } from "../../../config/database";

export const findSettingsByUserId = (userId: string) =>
    prisma.notification_Settings.findUnique({ where: { user_id: userId } });

    export const updateSettings = (
    userId: string,
    data: Prisma.Notification_SettingsUpdateInput
    ) =>
    prisma.notification_Settings.update({
        where: { user_id: userId },
        data,
});