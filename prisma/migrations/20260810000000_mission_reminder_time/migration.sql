-- AlterTable
ALTER TABLE `Notification_Settings` ADD COLUMN `mission_reminder_time` VARCHAR(5) NOT NULL DEFAULT '09:00';

-- CreateIndex
CREATE INDEX `Notification_Settings_mission_reminder_time_mission_remind_idx` ON `Notification_Settings`(`mission_reminder_time`, `mission_reminder`, `user_id`);
