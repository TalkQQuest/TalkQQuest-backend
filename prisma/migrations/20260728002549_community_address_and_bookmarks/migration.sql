-- #114: 모임 상세 주소 컬럼 추가, 모임 저장(북마크) 기능을 위한 테이블 추가.

-- AlterTable
ALTER TABLE `Communities` ADD COLUMN `address` VARCHAR(255) NULL AFTER `region`;

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
ALTER TABLE `Community_Bookmarks` ADD CONSTRAINT `Community_Bookmarks_community_id_fkey` FOREIGN KEY (`community_id`) REFERENCES `Communities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Community_Bookmarks` ADD CONSTRAINT `Community_Bookmarks_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `Users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
