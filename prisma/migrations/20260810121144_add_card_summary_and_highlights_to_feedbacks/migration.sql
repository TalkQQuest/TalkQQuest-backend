-- AlterTable
ALTER TABLE `Feedbacks` ADD COLUMN `card_summary` TEXT NULL,
    ADD COLUMN `conversation_highlights` JSON NULL;
