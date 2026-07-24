-- AlterTable
ALTER TABLE `Feedbacks` DROP COLUMN `improvements`,
    DROP COLUMN `strengths`,
    ADD COLUMN `metrics_detail` JSON NULL,
    ADD COLUMN `mission_summary` JSON NULL,
    ADD COLUMN `topic` VARCHAR(255) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Feedbacks_conversation_id_key` ON `Feedbacks`(`conversation_id`);
