-- 1. 백링크를 외래 키로 승격.
--    지금까지는 일반 문자열 컬럼이라 이미 삭제된 미션의 id가 남을 수 있었다.
--    FK를 걸기 전에 그런 고아 값을 먼저 null로 정리한다(정리하지 않으면 ALTER가 실패한다).
UPDATE `Recommendation_Logs` rl
LEFT JOIN `Missions` m ON m.`id` = rl.`created_mission_id`
SET rl.`created_mission_id` = NULL
WHERE rl.`created_mission_id` IS NOT NULL AND m.`id` IS NULL;

CREATE INDEX `Recommendation_Logs_created_mission_id_idx`
  ON `Recommendation_Logs`(`created_mission_id`);

ALTER TABLE `Recommendation_Logs`
  ADD CONSTRAINT `Recommendation_Logs_created_mission_id_fkey`
  FOREIGN KEY (`created_mission_id`) REFERENCES `Missions`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. 새로고침 슬롯 예약용 컬럼.
--    LLM 호출 전에 (user, 날짜, 순번)으로 행을 만들어 슬롯을 선점하고, unique 제약이
--    동시 요청 중 하나만 통과시킨다. 기존 행은 null로 남으며 MySQL unique는 null을
--    서로 다르게 취급하므로 과거 데이터끼리 충돌하지 않는다.
ALTER TABLE `Recommendation_Logs` ADD COLUMN `refresh_index` INT NULL;

CREATE UNIQUE INDEX `Recommendation_Logs_user_id_recommended_date_refresh_index_key`
  ON `Recommendation_Logs`(`user_id`, `recommended_date`, `refresh_index`);
