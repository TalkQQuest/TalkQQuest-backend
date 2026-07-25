-- Recommendation_Logs
-- 미션 추천(1~4단계) 호출 기록. AI 추천 품질 개선·오류 추적용.
-- ERD Cloud import용 DDL (기존 ERD 스타일에 맞춰 FK 없이 PK만 선언).

CREATE TABLE `Recommendation_Logs` (
`id` CHAR(36) NOT NULL,
`user_id` CHAR(36) NOT NULL,
`source` ENUM('llm', 'template', 'fallback') NOT NULL COMMENT '최종 추천을 만든 단계',
`llm_model` VARCHAR(50) NULL COMMENT '사용한 LLM 모델명, 비-LLM이면 NULL',
`target_difficulty` INT NULL COMMENT '2단계에서 계산한 목표 난이도 (1-3)',
`avoided_categories` JSON NULL COMMENT '2단계 회피 카테고리 배열',
`prompt_input` JSON NULL COMMENT 'LLM에 보낸 힌트/메시지, 비-LLM이면 NULL',
`raw_response` TEXT NULL COMMENT 'LLM 원문 응답 (파싱 전)',
`parse_success` BOOLEAN NOT NULL DEFAULT FALSE COMMENT '응답 파싱/스키마 검증 성공 여부',
`recommended_mission` JSON NULL COMMENT '최종 반환된 추천 미션(RecommendedMission)',
`fallback_reason` VARCHAR(100) NULL COMMENT '폴백 사유(no_api_key/http_error/invalid_json/schema_invalid/timeout), 성공 시 NULL',
`created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE `Recommendation_Logs` ADD CONSTRAINT `PK_RECOMMENDATION_LOGS` PRIMARY KEY (
`id`
);
