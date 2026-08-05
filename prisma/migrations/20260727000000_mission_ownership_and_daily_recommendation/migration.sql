-- 미션 목록의 공개 범위 판단과 "오늘의 미션" 일일 캐시를 위한 컬럼 추가.
--
--  1) Missions.created_by_user_id / creator_personality_type
--     AI 추천으로 생성된 미션이 실제 Missions 행으로 저장되면서, 관리자 템플릿과 구분하고
--     "나와 비슷한 성향의 사용자가 수행한 미션"만 목록에 노출하기 위해 필요하다.
--     creator_personality_type은 생성 시점 값을 비정규화해 굳혀 둔다(생성자가 나중에 성향을
--     바꿔도 이미 만들어진 미션의 대상 성향은 변하면 안 되므로 조인 대신 컬럼으로 둔다).
--
--  2) Recommendation_Logs.recommended_date
--     오늘의 미션 캐시(하루 1건)와 새로고침 횟수 제한(하루 3회)의 버킷 키.
--     사용자 시간대에 따라 "하루"의 경계가 달라져 created_at 범위 계산으로는 부정확하다.
--
-- 모두 nullable이라 기존 데이터에는 영향이 없다. 다만 이 마이그레이션 이전에 만들어진
-- AI 생성 미션(is_template=false, created_by_user_id NULL)은 소유자를 알 수 없어
-- 새 목록 필터에서 제외된다 — 템플릿 미션과 신규 생성분만 노출된다.

-- AlterTable
ALTER TABLE `Missions` ADD COLUMN `created_by_user_id` CHAR(36) NULL;
ALTER TABLE `Missions` ADD COLUMN `creator_personality_type` ENUM('introvert', 'extrovert', 'ambivert') NULL;

-- CreateIndex
-- FK보다 먼저 만들어야 MySQL이 FK용 인덱스를 따로 자동 생성하지 않고 이 인덱스를 재사용한다.
CREATE INDEX `Missions_created_by_user_id_idx` ON `Missions`(`created_by_user_id`);
CREATE INDEX `Missions_is_template_creator_personality_type_idx` ON `Missions`(`is_template`, `creator_personality_type`);

-- AddForeignKey
-- 탈퇴/삭제된 사용자의 미션은 남기되 소유자만 끊는다(SET NULL) — 다른 사용자가 이미 수행한
-- 미션이 사용자 삭제로 함께 사라지면 그 수행 기록이 깨지기 때문에 CASCADE를 쓰지 않는다.
ALTER TABLE `Missions` ADD CONSTRAINT `Missions_created_by_user_id_fkey`
  FOREIGN KEY (`created_by_user_id`) REFERENCES `Users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE `Recommendation_Logs` ADD COLUMN `recommended_date` DATE NULL;

-- CreateIndex
CREATE INDEX `Recommendation_Logs_user_id_recommended_date_idx` ON `Recommendation_Logs`(`user_id`, `recommended_date`);
