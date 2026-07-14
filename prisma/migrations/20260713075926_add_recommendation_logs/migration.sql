-- CreateTable
CREATE TABLE `Recommendation_Logs` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `source` ENUM('llm', 'template', 'fallback') NOT NULL,
    `llm_model` VARCHAR(50) NULL,
    `target_difficulty` INTEGER NULL,
    `avoided_categories` JSON NULL,
    `prompt_input` JSON NULL,
    `raw_response` TEXT NULL,
    `parse_success` BOOLEAN NOT NULL DEFAULT false,
    `recommended_mission` JSON NULL,
    `fallback_reason` VARCHAR(100) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Recommendation_Logs` ADD CONSTRAINT `Recommendation_Logs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `Users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
