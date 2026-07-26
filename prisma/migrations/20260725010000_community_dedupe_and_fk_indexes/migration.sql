-- 코드 리뷰 반영: Community_Join_Requests 중복 신청 방지, DeviceTokenPlatform에 ios 추가,
-- 조회가 잦은 FK 컬럼에 인덱스 추가.
-- 참고: 이 인덱스들 중 다수는 MySQL이 FK 제약을 걸 때 자동 생성한 인덱스를 Prisma 네이밍(_idx)에
-- 맞춰 RENAME하는 것뿐이라 실제로 새로 스캔이 도는 인덱스 생성은 아니다.
-- Communities/Chat_Messages/Calendar_Events/Community_Join_Requests/Community_Members는
-- schema.prisma에는 이미 있었지만 지금까지 한 번도 마이그레이션이 만들어진 적이 없어서(#70과 같은 패턴)
-- 이번에 처음 테이블을 생성한다.

-- AlterTable: DeviceTokenPlatform에 ios 추가
ALTER TABLE `Device_Tokens` MODIFY `platform` ENUM('android', 'ios') NOT NULL DEFAULT 'android';

-- RenameIndex: FK 자동 생성 인덱스 -> Prisma @@index 네이밍
ALTER TABLE `Refresh_Tokens` RENAME INDEX `Refresh_Tokens_user_id_fkey` TO `Refresh_Tokens_user_id_idx`;
ALTER TABLE `Goals` RENAME INDEX `Goals_user_id_fkey` TO `Goals_user_id_idx`;
ALTER TABLE `Mission_Saves` RENAME INDEX `Mission_Saves_mission_id_fkey` TO `Mission_Saves_mission_id_idx`;
ALTER TABLE `Conversations` RENAME INDEX `Conversations_user_id_fkey` TO `Conversations_user_id_idx`;
ALTER TABLE `Conversations` RENAME INDEX `Conversations_mission_id_fkey` TO `Conversations_mission_id_idx`;
ALTER TABLE `Mission_Records` RENAME INDEX `Mission_Records_user_id_fkey` TO `Mission_Records_user_id_idx`;
ALTER TABLE `Mission_Records` RENAME INDEX `Mission_Records_mission_id_fkey` TO `Mission_Records_mission_id_idx`;
ALTER TABLE `Mission_Records` RENAME INDEX `Mission_Records_conversation_id_fkey` TO `Mission_Records_conversation_id_idx`;
ALTER TABLE `Feedbacks` RENAME INDEX `Feedbacks_user_id_fkey` TO `Feedbacks_user_id_idx`;
ALTER TABLE `Saved_Phrases` RENAME INDEX `Saved_Phrases_user_id_fkey` TO `Saved_Phrases_user_id_idx`;
ALTER TABLE `Saved_Phrases` RENAME INDEX `Saved_Phrases_conversation_id_fkey` TO `Saved_Phrases_conversation_id_idx`;
ALTER TABLE `Recommendation_Logs` RENAME INDEX `Recommendation_Logs_user_id_fkey` TO `Recommendation_Logs_user_id_idx`;
ALTER TABLE `Payments` RENAME INDEX `Payments_user_id_fkey` TO `Payments_user_id_idx`;
ALTER TABLE `Payments` RENAME INDEX `Payments_subscription_id_fkey` TO `Payments_subscription_id_idx`;
ALTER TABLE `Subscriptions` RENAME INDEX `Subscriptions_user_id_fkey` TO `Subscriptions_user_id_idx`;
ALTER TABLE `Subscriptions` RENAME INDEX `Subscriptions_plan_id_fkey` TO `Subscriptions_plan_id_idx`;
ALTER TABLE `User_Badges` RENAME INDEX `User_Badges_badge_id_fkey` TO `User_Badges_badge_id_idx`;
ALTER TABLE `Notifications` RENAME INDEX `Notifications_user_id_fkey` TO `Notifications_user_id_idx`;
ALTER TABLE `Archive_Folders` RENAME INDEX `Archive_Folders_user_id_fkey` TO `Archive_Folders_user_id_idx`;
ALTER TABLE `Archive_Items` RENAME INDEX `Archive_Items_user_id_fkey` TO `Archive_Items_user_id_idx`;
ALTER TABLE `Archive_Items` RENAME INDEX `Archive_Items_folder_id_fkey` TO `Archive_Items_folder_id_idx`;
ALTER TABLE `Blocked_Users` RENAME INDEX `Blocked_Users_blocked_user_id_fkey` TO `Blocked_Users_blocked_user_id_idx`;
ALTER TABLE `Device_Tokens` RENAME INDEX `Device_Tokens_user_id_fkey` TO `Device_Tokens_user_id_idx`;
ALTER TABLE `Reports` RENAME INDEX `Reports_user_id_fkey` TO `Reports_user_id_idx`;
ALTER TABLE `Login_History` RENAME INDEX `Login_History_user_id_fkey` TO `Login_History_user_id_idx`;

-- CreateTable: Communities 도메인 5개 테이블은 schema.prisma에는 있었지만 마이그레이션이 없어 처음 생성한다.
CREATE TABLE `Communities` (
    `id` CHAR(36) NOT NULL,
    `host_user_id` CHAR(36) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `description` TEXT NULL,
    `category` VARCHAR(100) NULL,
    `region` VARCHAR(100) NULL,
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

CREATE TABLE `Chat_Messages` (
    `id` CHAR(36) NOT NULL,
    `community_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `content` TEXT NOT NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `Chat_Messages_community_id_idx`(`community_id`),
    INDEX `Chat_Messages_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

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

-- AddForeignKey
ALTER TABLE `Communities` ADD CONSTRAINT `Communities_host_user_id_fkey` FOREIGN KEY (`host_user_id`) REFERENCES `Users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Chat_Messages` ADD CONSTRAINT `Chat_Messages_community_id_fkey` FOREIGN KEY (`community_id`) REFERENCES `Communities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Chat_Messages` ADD CONSTRAINT `Chat_Messages_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `Users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Calendar_Events` ADD CONSTRAINT `Calendar_Events_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `Users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Calendar_Events` ADD CONSTRAINT `Calendar_Events_community_id_fkey` FOREIGN KEY (`community_id`) REFERENCES `Communities`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Community_Join_Requests` ADD CONSTRAINT `Community_Join_Requests_community_id_fkey` FOREIGN KEY (`community_id`) REFERENCES `Communities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Community_Join_Requests` ADD CONSTRAINT `Community_Join_Requests_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `Users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Community_Members` ADD CONSTRAINT `Community_Members_community_id_fkey` FOREIGN KEY (`community_id`) REFERENCES `Communities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Community_Members` ADD CONSTRAINT `Community_Members_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `Users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
