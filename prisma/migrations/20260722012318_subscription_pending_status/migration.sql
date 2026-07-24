-- AlterTable
ALTER TABLE `Subscriptions` MODIFY `status` ENUM('pending', 'active', 'expired', 'cancelled') NOT NULL DEFAULT 'pending';
