-- CreateTable
CREATE TABLE `Users` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(50) NOT NULL,
    `school_or_job` VARCHAR(100) NOT NULL,
    `birth_date` VARCHAR(10) NOT NULL,
    `terms_agreed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_login_at` DATETIME(3) NULL,
    `status` ENUM('active', 'inactive', 'deleted') NOT NULL DEFAULT 'active',
    `deleted_at` DATETIME(3) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Auth_Identities` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `provider` ENUM('email', 'kakao', 'naver') NOT NULL,
    `provider_user_id` VARCHAR(255) NULL,
    `email` VARCHAR(255) NULL,
    `password_hash` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Auth_Identities_provider_provider_user_id_key`(`provider`, `provider_user_id`),
    UNIQUE INDEX `Auth_Identities_provider_email_key`(`provider`, `email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Refresh_Tokens` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `token` VARCHAR(512) NOT NULL,
    `device_info` JSON NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `revoked` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Refresh_Tokens_token_key`(`token`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Terms` (
    `id` CHAR(36) NOT NULL,
    `type` ENUM('terms', 'privacy') NOT NULL,
    `version` VARCHAR(20) NOT NULL,
    `content` TEXT NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `User_Profiles` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `nickname` VARCHAR(50) NULL,
    `status_type` VARCHAR(50) NULL,
    `personality_type` ENUM('introvert', 'extrovert', 'ambivert') NULL,
    `difficult_situations` JSON NULL,
    `preferred_style` VARCHAR(255) NULL,
    `interests` JSON NULL,
    `purpose` VARCHAR(255) NULL,
    `avatar_url` VARCHAR(500) NULL,
    `bio` TEXT NULL,
    `daily_conversation_goal` INTEGER NOT NULL DEFAULT 1,
    `level` INTEGER NOT NULL DEFAULT 1,
    `xp` INTEGER NOT NULL DEFAULT 0,
    `onboarding_completed` BOOLEAN NOT NULL DEFAULT false,
    `onboarding_step` INTEGER NOT NULL DEFAULT 0,
    `onboarding_temp_data` JSON NULL,
    `created_at` DATETIME(3) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_Profiles_user_id_key`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Goals` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `goal_type` VARCHAR(50) NOT NULL,
    `target` VARCHAR(255) NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Missions` (
    `id` CHAR(36) NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `description` TEXT NOT NULL,
    `preparation_tip` TEXT NULL,
    `caution` TEXT NULL,
    `difficulty` INTEGER NOT NULL,
    `estimated_minutes` INTEGER NOT NULL,
    `reward_xp` INTEGER NOT NULL DEFAULT 0,
    `category` VARCHAR(100) NOT NULL,
    `is_template` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Mission_Prep_Items` (
    `id` CHAR(36) NOT NULL,
    `mission_id` CHAR(36) NOT NULL,
    `type` ENUM('question', 'starter', 'tip') NOT NULL,
    `content` TEXT NOT NULL,
    `order_index` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Mission_Saves` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `mission_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Mission_Saves_user_id_mission_id_key`(`user_id`, `mission_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Conversations` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `mission_id` CHAR(36) NOT NULL,
    `mode` VARCHAR(50) NULL,
    `selected_topic` VARCHAR(255) NULL,
    `status` ENUM('in_progress', 'completed', 'abandoned') NOT NULL DEFAULT 'in_progress',
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finished_at` DATETIME(3) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Conversation_Messages` (
    `id` CHAR(36) NOT NULL,
    `conversation_id` CHAR(36) NOT NULL,
    `role` ENUM('user', 'guide', 'system') NOT NULL,
    `content` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Mission_Records` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `mission_id` CHAR(36) NOT NULL,
    `conversation_id` CHAR(36) NULL,
    `result` ENUM('success', 'failure', 'avoidance') NOT NULL,
    `memo` TEXT NULL,
    `duration_minutes` INTEGER NULL,
    `emotion` VARCHAR(50) NULL,
    `xp_earned` INTEGER NOT NULL DEFAULT 0,
    `status` ENUM('in_progress', 'completed') NOT NULL DEFAULT 'in_progress',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completed_at` DATETIME(3) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `XP_History` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `amount` INTEGER NOT NULL,
    `reason` VARCHAR(255) NOT NULL,
    `reference_id` CHAR(36) NULL,
    `reference_type` VARCHAR(50) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Feedbacks` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `conversation_id` CHAR(36) NOT NULL,
    `kindness_score` INTEGER NULL,
    `initiative_score` INTEGER NULL,
    `empathy_score` INTEGER NULL,
    `question_link_score` INTEGER NULL,
    `strengths` JSON NULL,
    `improvements` JSON NULL,
    `saved_phrase` TEXT NULL,
    `status` ENUM('pending', 'ready', 'failed') NOT NULL DEFAULT 'pending',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Saved_Phrases` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `conversation_id` CHAR(36) NULL,
    `content` TEXT NOT NULL,
    `memo` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Auth_Identities` ADD CONSTRAINT `Auth_Identities_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `Users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Refresh_Tokens` ADD CONSTRAINT `Refresh_Tokens_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `Users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `User_Profiles` ADD CONSTRAINT `User_Profiles_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `Users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Goals` ADD CONSTRAINT `Goals_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `Users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Mission_Prep_Items` ADD CONSTRAINT `Mission_Prep_Items_mission_id_fkey` FOREIGN KEY (`mission_id`) REFERENCES `Missions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Mission_Saves` ADD CONSTRAINT `Mission_Saves_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `Users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Mission_Saves` ADD CONSTRAINT `Mission_Saves_mission_id_fkey` FOREIGN KEY (`mission_id`) REFERENCES `Missions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Conversations` ADD CONSTRAINT `Conversations_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `Users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Conversations` ADD CONSTRAINT `Conversations_mission_id_fkey` FOREIGN KEY (`mission_id`) REFERENCES `Missions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Conversation_Messages` ADD CONSTRAINT `Conversation_Messages_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `Conversations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Mission_Records` ADD CONSTRAINT `Mission_Records_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `Users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Mission_Records` ADD CONSTRAINT `Mission_Records_mission_id_fkey` FOREIGN KEY (`mission_id`) REFERENCES `Missions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Mission_Records` ADD CONSTRAINT `Mission_Records_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `Conversations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `XP_History` ADD CONSTRAINT `XP_History_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `Users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Feedbacks` ADD CONSTRAINT `Feedbacks_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `Users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Feedbacks` ADD CONSTRAINT `Feedbacks_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `Conversations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Saved_Phrases` ADD CONSTRAINT `Saved_Phrases_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `Users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Saved_Phrases` ADD CONSTRAINT `Saved_Phrases_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `Conversations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
