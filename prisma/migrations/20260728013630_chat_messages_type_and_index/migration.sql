-- #115: 실시간 채팅에 필요한 Chat_Messages 보강.
-- DropForeignKey
ALTER TABLE `Chat_Messages` DROP FOREIGN KEY `Chat_Messages_user_id_fkey`;

-- DropForeignKey (community_id FK도 먼저 제거)
ALTER TABLE `Chat_Messages` DROP FOREIGN KEY `Chat_Messages_community_id_fkey`;

-- DropIndex
DROP INDEX `Chat_Messages_community_id_idx` ON `Chat_Messages`;

-- AlterTable
ALTER TABLE `Chat_Messages`
  MODIFY `user_id` CHAR(36) NULL,
  ADD COLUMN `type` ENUM('text', 'system') NOT NULL DEFAULT 'text';

-- CreateIndex
CREATE INDEX `Chat_Messages_community_id_created_at_idx` ON `Chat_Messages`(`community_id`, `created_at`);

-- AddForeignKey
ALTER TABLE `Chat_Messages` ADD CONSTRAINT `Chat_Messages_community_id_fkey` FOREIGN KEY (`community_id`) REFERENCES `Communities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Chat_Messages` ADD CONSTRAINT `Chat_Messages_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `Users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
