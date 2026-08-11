-- #159 — Device_Tokens.fcm_token에 unique 제약 추가.
--
-- 토큰 자체가 "이 기기의 이 앱 설치본"을 가리키는 고유 값이다. 이 제약이 있어야
-- 재등록(같은 토큰으로 다시 POST)을 upsert로 처리해 중복 행 없이 last_active_at만
-- 갱신할 수 있다.
--
-- 참고: `prisma migrate diff`가 함께 뱉는 여러 테이블의
-- `MODIFY updated_at TIMESTAMP(0) ... ON UPDATE CURRENT_TIMESTAMP`는 baseline과 정의가
-- 동일한 no-op(= Prisma가 dbgenerated를 왕복하며 생기는 노이즈)이라 의도적으로 뺐다.

-- CreateIndex
CREATE UNIQUE INDEX `Device_Tokens_fcm_token_key` ON `Device_Tokens`(`fcm_token`);
