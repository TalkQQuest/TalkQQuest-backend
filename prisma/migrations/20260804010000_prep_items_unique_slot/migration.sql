-- 첫 마디 후보(Mission_Prep_Items)의 중복 삽입 방지.
-- 캐시가 비었을 때 생성하는 구조라 조회와 삽입 사이에 잠금이 없고, 동시 요청이 모두
-- 빈 캐시를 읽으면 같은 미션에 후보가 두 벌 쌓인다.

-- unique 인덱스를 걸기 전에 이미 쌓인 중복을 정리한다(남기지 않으면 CREATE INDEX가 실패한다).
-- 같은 (mission_id, type, order_index) 중 가장 먼저 만들어진 한 행만 남긴다.
DELETE t FROM `Mission_Prep_Items` t
JOIN `Mission_Prep_Items` keep
  ON keep.`mission_id` = t.`mission_id`
 AND keep.`type` = t.`type`
 AND keep.`order_index` = t.`order_index`
 AND (
      keep.`created_at` < t.`created_at`
      OR (keep.`created_at` = t.`created_at` AND keep.`id` < t.`id`)
     );

CREATE UNIQUE INDEX `Mission_Prep_Items_mission_id_type_order_index_key`
  ON `Mission_Prep_Items`(`mission_id`, `type`, `order_index`);
