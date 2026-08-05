-- 마이그레이션 히스토리 베이스라인 (#134).
--
-- 오랫동안 `db push`로만 스키마를 관리해온 탓에 `prisma/migrations` 히스토리와 실제 DB 상태가
-- 어긋나 있었고, 그로 인해 로컬 shadow DB(`migrate dev`)와 운영 `migrate deploy`가 모두
-- 반복적으로 실패했다. 기존 마이그레이션 폴더를 전부 지우고, 이 시점(2026-08-05, 운영 DB에
-- `db push`로 스키마를 schema.prisma와 완전히 동기화한 직후)의 스키마를 단일 baseline으로
-- 다시 만들었다.
--
-- 운영 DB에는 이 SQL을 실제로 실행하지 않는다 — 이미 db push로 동일한 상태이므로
-- `prisma migrate resolve --applied 20260805170000_baseline`로 "적용됨"만 기록한다.
-- 로컬/테스트 DB는 초기화 후 이 baseline부터 새로 쌓는다.
--
-- 이 시점 이후의 스키마 변경은 전부 이 baseline 위에 새 마이그레이션으로 쌓을 것.

-- CreateTable
CREATE TABLE `Users` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(50) NOT NULL,
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
    `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

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
    INDEX `Refresh_Tokens_user_id_idx`(`user_id`),
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
    `purpose` JSON NULL,
    `avatar_url` VARCHAR(500) NULL,
    `bio` TEXT NULL,
    `daily_conversation_goal` INTEGER NOT NULL DEFAULT 1,
    `level` INTEGER NOT NULL DEFAULT 1,
    `xp` INTEGER NOT NULL DEFAULT 0,
    `onboarding_completed` BOOLEAN NOT NULL DEFAULT false,
    `onboarding_step` INTEGER NOT NULL DEFAULT 0,
    `onboarding_temp_data` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

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
    `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX `Goals_user_id_idx`(`user_id`),
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
    `created_by_user_id` CHAR(36) NULL,
    `creator_personality_type` ENUM('introvert', 'extrovert', 'ambivert') NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Missions_created_by_user_id_idx`(`created_by_user_id`),
    INDEX `Missions_is_template_creator_personality_type_idx`(`is_template`, `creator_personality_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Mission_Playbooks` (
    `id` CHAR(36) NOT NULL,
    `mission_id` CHAR(36) NOT NULL,
    `data` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE INDEX `Mission_Playbooks_mission_id_key`(`mission_id`),
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

    UNIQUE INDEX `Mission_Prep_Items_mission_id_type_order_index_key`(`mission_id`, `type`, `order_index`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Mission_Saves` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `mission_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Mission_Saves_mission_id_idx`(`mission_id`),
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
    `persona` VARCHAR(255) NULL,
    `user_task` VARCHAR(255) NULL,
    `flow_step` INTEGER NOT NULL DEFAULT 0,
    `status` ENUM('in_progress', 'completed', 'abandoned') NOT NULL DEFAULT 'in_progress',
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finished_at` DATETIME(3) NULL,

    INDEX `Conversations_user_id_idx`(`user_id`),
    INDEX `Conversations_mission_id_idx`(`mission_id`),
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

    INDEX `Mission_Records_user_id_idx`(`user_id`),
    INDEX `Mission_Records_mission_id_idx`(`mission_id`),
    INDEX `Mission_Records_conversation_id_idx`(`conversation_id`),
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
    `metrics` JSON NULL,
    `mission_summary` JSON NULL,
    `summary_chips` JSON NULL,
    `conversation_summary` TEXT NULL,
    `saved_phrase` TEXT NULL,
    `status` ENUM('pending', 'ready', 'failed') NOT NULL DEFAULT 'pending',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Feedbacks_conversation_id_key`(`conversation_id`),
    INDEX `Feedbacks_user_id_idx`(`user_id`),
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

    INDEX `Saved_Phrases_user_id_idx`(`user_id`),
    INDEX `Saved_Phrases_conversation_id_idx`(`conversation_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

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
    `created_mission_id` CHAR(36) NULL,
    `refresh_index` INTEGER NULL,
    `recommended_date` DATE NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Recommendation_Logs_user_id_idx`(`user_id`),
    INDEX `Recommendation_Logs_user_id_recommended_date_idx`(`user_id`, `recommended_date`),
    INDEX `Recommendation_Logs_created_mission_id_idx`(`created_mission_id`),
    UNIQUE INDEX `Recommendation_Logs_user_id_recommended_date_refresh_index_key`(`user_id`, `recommended_date`, `refresh_index`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Usage` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `cycle_start` DATE NOT NULL,
    `ai_count` INTEGER NOT NULL DEFAULT 0,
    `feedback_count` INTEGER NOT NULL DEFAULT 0,
    `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX `Usage_user_id_idx`(`user_id`),
    UNIQUE INDEX `Usage_user_id_cycle_start_key`(`user_id`, `cycle_start`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Plans` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `price` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'KRW',
    `ai_limit` INTEGER NULL,
    `feedback_limit` INTEGER NULL,
    `features` JSON NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Subscriptions` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `plan_id` CHAR(36) NOT NULL,
    `status` ENUM('pending', 'active', 'expired', 'cancelled') NOT NULL DEFAULT 'pending',
    `started_at` DATETIME(3) NOT NULL,
    `expires_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Subscriptions_user_id_idx`(`user_id`),
    INDEX `Subscriptions_plan_id_idx`(`plan_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Payments` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `subscription_id` CHAR(36) NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'KRW',
    `method` VARCHAR(50) NOT NULL,
    `status` ENUM('pending', 'completed', 'failed', 'refunded') NOT NULL,
    `external_id` VARCHAR(255) NULL,
    `retry_count` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completed_at` DATETIME(3) NULL,

    INDEX `Payments_user_id_idx`(`user_id`),
    INDEX `Payments_subscription_id_idx`(`subscription_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Badges` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `description` TEXT NULL,
    `condition` JSON NOT NULL,
    `icon_url` VARCHAR(500) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `User_Badges` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `badge_id` CHAR(36) NOT NULL,
    `earned_at` DATETIME(3) NOT NULL,

    INDEX `User_Badges_badge_id_idx`(`badge_id`),
    UNIQUE INDEX `User_Badges_user_id_badge_id_key`(`user_id`, `badge_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Notifications` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `type` VARCHAR(50) NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `body` TEXT NULL,
    `reference_id` CHAR(36) NULL,
    `reference_type` VARCHAR(50) NULL,
    `is_read` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Notifications_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Notification_Settings` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `mission_reminder` BOOLEAN NOT NULL DEFAULT true,
    `community_approved` BOOLEAN NOT NULL DEFAULT true,
    `report_ready` BOOLEAN NOT NULL DEFAULT true,
    `marketing` BOOLEAN NOT NULL DEFAULT false,
    `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE INDEX `Notification_Settings_user_id_key`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Archive_Folders` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX `Archive_Folders_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Archive_Items` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `folder_id` CHAR(36) NULL,
    `item_type` ENUM('conversation', 'phrase', 'report', 'mission') NOT NULL,
    `reference_id` CHAR(36) NOT NULL,
    `tags` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Archive_Items_user_id_idx`(`user_id`),
    INDEX `Archive_Items_folder_id_idx`(`folder_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Blocked_Users` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `blocked_user_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Blocked_Users_blocked_user_id_idx`(`blocked_user_id`),
    UNIQUE INDEX `Blocked_Users_user_id_blocked_user_id_key`(`user_id`, `blocked_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Device_Tokens` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `fcm_token` VARCHAR(500) NOT NULL,
    `platform` ENUM('android', 'ios') NOT NULL DEFAULT 'android',
    `last_active_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Device_Tokens_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Email_Verifications` (
    `id` CHAR(36) NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `code` VARCHAR(10) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `verified` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Reports` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `period` VARCHAR(30) NOT NULL,
    `data` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Reports_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Login_History` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `device_info` JSON NULL,
    `ip_address` VARCHAR(45) NULL,
    `logged_in_at` DATETIME(3) NOT NULL,

    INDEX `Login_History_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Communities` (
    `id` CHAR(36) NOT NULL,
    `host_user_id` CHAR(36) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `description` TEXT NULL,
    `category` VARCHAR(100) NULL,
    `region` VARCHAR(100) NULL,
    `address` VARCHAR(255) NULL,
    `capacity` INTEGER NOT NULL,
    `current_members` INTEGER NOT NULL DEFAULT 0,
    `started_at` TIMESTAMP(0) NULL,
    `ended_at` TIMESTAMP(0) NULL,
    `cover_image_url` VARCHAR(500) NULL,
    `tags` JSON NULL,
    `visibility` ENUM('public', 'private') NOT NULL DEFAULT 'public',
    `status` ENUM('draft', 'open', 'closed') NOT NULL DEFAULT 'draft',
    `interests` JSON NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `Communities_host_user_id_idx`(`host_user_id`),
    INDEX `Communities_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Chat_Messages` (
    `id` CHAR(36) NOT NULL,
    `community_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NULL,
    `content` TEXT NOT NULL,
    `type` ENUM('text', 'system') NOT NULL DEFAULT 'text',
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `Chat_Messages_user_id_idx`(`user_id`),
    INDEX `Chat_Messages_community_id_created_at_idx`(`community_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Calendar_Events` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `community_id` CHAR(36) NULL,
    `title` VARCHAR(255) NOT NULL,
    `started_at` TIMESTAMP(0) NOT NULL,
    `ended_at` TIMESTAMP(0) NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `Calendar_Events_user_id_idx`(`user_id`),
    INDEX `Calendar_Events_community_id_idx`(`community_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Community_Join_Requests` (
    `id` CHAR(36) NOT NULL,
    `community_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `status` ENUM('pending', 'approved', 'rejected', 'cancelled', 'waitlisted') NOT NULL DEFAULT 'pending',
    `waitlist_order` INTEGER NULL,
    `message` TEXT NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX `Community_Join_Requests_user_id_idx`(`user_id`),
    INDEX `Community_Join_Requests_community_id_idx`(`community_id`),
    UNIQUE INDEX `Community_Join_Requests_community_id_user_id_key`(`community_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Community_Members` (
    `id` CHAR(36) NOT NULL,
    `community_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `role` ENUM('host', 'member') NOT NULL DEFAULT 'member',
    `joined_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `Community_Members_user_id_idx`(`user_id`),
    UNIQUE INDEX `Community_Members_community_id_user_id_key`(`community_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Community_Bookmarks` (
    `id` CHAR(36) NOT NULL,
    `community_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `Community_Bookmarks_user_id_idx`(`user_id`),
    UNIQUE INDEX `Community_Bookmarks_community_id_user_id_key`(`community_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Auth_Identities` ADD CONSTRAINT `Auth_Identities_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `Users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Refresh_Tokens` ADD CONSTRAINT `Refresh_Tokens_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `Users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `User_Profiles` ADD CONSTRAINT `User_Profiles_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `Users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Goals` ADD CONSTRAINT `Goals_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `Users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Missions` ADD CONSTRAINT `Missions_created_by_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `Users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Mission_Playbooks` ADD CONSTRAINT `Mission_Playbooks_mission_id_fkey` FOREIGN KEY (`mission_id`) REFERENCES `Missions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Mission_Prep_Items` ADD CONSTRAINT `Mission_Prep_Items_mission_id_fkey` FOREIGN KEY (`mission_id`) REFERENCES `Missions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Mission_Saves` ADD CONSTRAINT `Mission_Saves_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `Users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Mission_Saves` ADD CONSTRAINT `Mission_Saves_mission_id_fkey` FOREIGN KEY (`mission_id`) REFERENCES `Missions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Conversations` ADD CONSTRAINT `Conversations_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `Users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Conversations` ADD CONSTRAINT `Conversations_mission_id_fkey` FOREIGN KEY (`mission_id`) REFERENCES `Missions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Conversation_Messages` ADD CONSTRAINT `Conversation_Messages_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `Conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Mission_Records` ADD CONSTRAINT `Mission_Records_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `Users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Mission_Records` ADD CONSTRAINT `Mission_Records_mission_id_fkey` FOREIGN KEY (`mission_id`) REFERENCES `Missions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Mission_Records` ADD CONSTRAINT `Mission_Records_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `Conversations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `XP_History` ADD CONSTRAINT `XP_History_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `Users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Feedbacks` ADD CONSTRAINT `Feedbacks_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `Users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Feedbacks` ADD CONSTRAINT `Feedbacks_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `Conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Saved_Phrases` ADD CONSTRAINT `Saved_Phrases_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `Users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Saved_Phrases` ADD CONSTRAINT `Saved_Phrases_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `Conversations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Recommendation_Logs` ADD CONSTRAINT `Recommendation_Logs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `Users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Recommendation_Logs` ADD CONSTRAINT `Recommendation_Logs_created_mission_id_fkey` FOREIGN KEY (`created_mission_id`) REFERENCES `Missions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Usage` ADD CONSTRAINT `Usage_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `Users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Subscriptions` ADD CONSTRAINT `Subscriptions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `Users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Subscriptions` ADD CONSTRAINT `Subscriptions_plan_id_fkey` FOREIGN KEY (`plan_id`) REFERENCES `Plans`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Payments` ADD CONSTRAINT `Payments_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `Users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Payments` ADD CONSTRAINT `Payments_subscription_id_fkey` FOREIGN KEY (`subscription_id`) REFERENCES `Subscriptions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `User_Badges` ADD CONSTRAINT `User_Badges_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `Users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `User_Badges` ADD CONSTRAINT `User_Badges_badge_id_fkey` FOREIGN KEY (`badge_id`) REFERENCES `Badges`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notifications` ADD CONSTRAINT `Notifications_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `Users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notification_Settings` ADD CONSTRAINT `Notification_Settings_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `Users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Archive_Folders` ADD CONSTRAINT `Archive_Folders_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `Users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Archive_Items` ADD CONSTRAINT `Archive_Items_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `Users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Archive_Items` ADD CONSTRAINT `Archive_Items_folder_id_fkey` FOREIGN KEY (`folder_id`) REFERENCES `Archive_Folders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Blocked_Users` ADD CONSTRAINT `Blocked_Users_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `Users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Blocked_Users` ADD CONSTRAINT `Blocked_Users_blocked_user_id_fkey` FOREIGN KEY (`blocked_user_id`) REFERENCES `Users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Device_Tokens` ADD CONSTRAINT `Device_Tokens_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `Users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Reports` ADD CONSTRAINT `Reports_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `Users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Login_History` ADD CONSTRAINT `Login_History_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `Users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Communities` ADD CONSTRAINT `Communities_host_user_id_fkey` FOREIGN KEY (`host_user_id`) REFERENCES `Users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Chat_Messages` ADD CONSTRAINT `Chat_Messages_community_id_fkey` FOREIGN KEY (`community_id`) REFERENCES `Communities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Chat_Messages` ADD CONSTRAINT `Chat_Messages_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `Users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Calendar_Events` ADD CONSTRAINT `Calendar_Events_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `Users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Calendar_Events` ADD CONSTRAINT `Calendar_Events_community_id_fkey` FOREIGN KEY (`community_id`) REFERENCES `Communities`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Community_Join_Requests` ADD CONSTRAINT `Community_Join_Requests_community_id_fkey` FOREIGN KEY (`community_id`) REFERENCES `Communities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Community_Join_Requests` ADD CONSTRAINT `Community_Join_Requests_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `Users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Community_Members` ADD CONSTRAINT `Community_Members_community_id_fkey` FOREIGN KEY (`community_id`) REFERENCES `Communities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Community_Members` ADD CONSTRAINT `Community_Members_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `Users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Community_Bookmarks` ADD CONSTRAINT `Community_Bookmarks_community_id_fkey` FOREIGN KEY (`community_id`) REFERENCES `Communities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Community_Bookmarks` ADD CONSTRAINT `Community_Bookmarks_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `Users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

