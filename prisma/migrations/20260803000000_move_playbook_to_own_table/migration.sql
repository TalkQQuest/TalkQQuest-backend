-- 대화 플레이북을 Missions에서 별도 테이블로 분리.
--
-- 배경: 플레이북 JSON에 임베딩(4096차원 × 10개)을 함께 넣었더니 미션 1건이 **1.1MB**까지 커졌다.
-- Missions는 목록·추천·상세 등 여러 경로에서 조회되는 핫 테이블인데, select 없이 조회하는
-- 쿼리가 이 컬럼을 통째로 끌고 왔다. 특히 ORDER BY가 걸리면 MySQL sort_buffer_size(기본 256KB)를
-- 넘겨 `GET /missions`가 500(Out of sort memory)으로 죽었다.
--
-- 별도 테이블로 빼면 필요한 곳에서 명시적으로 join할 때만 로드된다.
-- mission_id는 unique — 미션당 플레이북 1건.
-- 미션이 지워지면 플레이북도 의미가 없으므로 CASCADE.

-- CreateTable
CREATE TABLE `Mission_Playbooks` (
    `id`         CHAR(36)  NOT NULL,
    `mission_id` CHAR(36)  NOT NULL,
    `data`       JSON      NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE INDEX `Mission_Playbooks_mission_id_key`(`mission_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 기존 플레이북 이관. UUID()는 CHAR(36) 형식이라 id 컬럼과 맞는다.
INSERT INTO `Mission_Playbooks` (`id`, `mission_id`, `data`)
SELECT UUID(), `id`, `dialogue_playbook`
FROM `Missions`
WHERE `dialogue_playbook` IS NOT NULL;

-- AddForeignKey
ALTER TABLE `Mission_Playbooks` ADD CONSTRAINT `Mission_Playbooks_mission_id_fkey`
  FOREIGN KEY (`mission_id`) REFERENCES `Missions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE `Missions` DROP COLUMN `dialogue_playbook`;
