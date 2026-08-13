-- 템플릿 미션의 preparation_tip / caution / setup_guideline 백필 (#227)
--
-- 시드된 템플릿 미션은 세 값이 비어 있어 GET /missions/{missionId}에서 그대로 null로 내려간다.
--   - preparation_tip: seed.ts의 TEMPLATE_MISSIONS에 키 자체가 없어 전부 NULL
--   - caution: 8건 중 3건이 null로 정의돼 있었음
--   - setup_guideline: 템플릿에는 채우는 경로가 아예 없어 전부 NULL
--     (LLM 생성 미션만 생성 시점에 함께 만들어진다)
--
-- 시드를 다시 돌려도 값은 채워지지만, seed.ts는 is_template=true 행을 delete 후 recreate하는
-- 구조이고 Missions는 Conversations·Mission_Records 등에 onDelete: Cascade로 물려 있다. 즉
-- 데이터가 쌓인 환경에서 시드를 재실행하면 해당 미션으로 진행한 대화 기록까지 함께 지워진다.
-- 그래서 여기서는 행을 지우지 않고 값만 채운다.
--
-- title로 매칭하는 이유: 시드 미션에 안정적인 고유 키가 title뿐이다(id는 uuid라 환경마다 다름).
-- 각 컬럼을 COALESCE로 채워 **이미 값이 있는 행은 건드리지 않는다** — 재실행해도 안전하고,
-- 운영자가 손으로 수정한 값도 덮어쓰지 않는다.
--
-- setup_guideline JSON은 mission.dto.ts의 setupGuidelineSchema와 형태가 정확히 일치해야 한다.
-- 한 필드라도 빠지면 파싱에 실패해 서버가 조용히 null로 응답한다.

UPDATE `Missions` SET
  `preparation_tip` = COALESCE(`preparation_tip`, '계산대에 서기 전에 ''안녕하세요'' 한마디를 속으로 한 번 연습해보세요.'),
  `caution` = COALESCE(`caution`, '부담되면 눈인사만으로 시작해도 괜찮아요.'),
  `setup_guideline` = COALESCE(`setup_guideline`, CAST('{"defaults":{"environment":"daily_place","partnerRole":"other","intimacyLevel":1,"formalityLevel":3,"partnerGender":"female","partnerAgeGroup":"twenties"},"disabled":{"environment":["online"],"partnerRole":[],"intimacyLevel":[],"formalityLevel":[],"partnerGender":[],"partnerAgeGroup":[]},"note":null,"recommendedTopics":[],"tags":["인사","짧은 대화","첫마디"]}' AS JSON))
WHERE `is_template` = 1 AND `title` = '편의점 점원에게 먼저 인사하기';

UPDATE `Missions` SET
  `preparation_tip` = COALESCE(`preparation_tip`, '메뉴판을 미리 훑어보고 궁금한 음료를 하나 정해두면 말을 꺼내기 쉬워요.'),
  `caution` = COALESCE(`caution`, '점원이 바빠 보이면 짧게 여쭤보고 주문을 마무리해도 충분해요.'),
  `setup_guideline` = COALESCE(`setup_guideline`, CAST('{"defaults":{"environment":"daily_place","partnerRole":"other","intimacyLevel":1,"formalityLevel":3,"partnerGender":"female","partnerAgeGroup":"twenties"},"disabled":{"environment":["online"],"partnerRole":[],"intimacyLevel":[],"formalityLevel":[],"partnerGender":[],"partnerAgeGroup":[]},"note":null,"recommendedTopics":[],"tags":["질문하기","주문","짧은 대화"]}' AS JSON))
WHERE `is_template` = 1 AND `title` = '카페에서 음료 추천 물어보기';

UPDATE `Missions` SET
  `preparation_tip` = COALESCE(`preparation_tip`, '수업이 끝나갈 무렵, 물어볼 내용을 한 문장으로 정리해두세요.'),
  `caution` = COALESCE(`caution`, '상대가 바빠 보이면 다음 기회를 노려도 좋아요.'),
  `setup_guideline` = COALESCE(`setup_guideline`, CAST('{"defaults":{"environment":"school","partnerRole":"peer","intimacyLevel":2,"formalityLevel":2,"partnerGender":"female","partnerAgeGroup":"twenties"},"disabled":{"environment":["online"],"partnerRole":[],"intimacyLevel":[],"formalityLevel":[],"partnerGender":[],"partnerAgeGroup":[]},"note":null,"recommendedTopics":[],"tags":["학교","질문하기","동기"]}' AS JSON))
WHERE `is_template` = 1 AND `title` = '옆자리 동기에게 과제 물어보기';

UPDATE `Missions` SET
  `preparation_tip` = COALESCE(`preparation_tip`, '상대가 좋아할 만한 주제를 한두 개 미리 떠올려두면 대화가 자연스럽게 이어져요.'),
  `caution` = COALESCE(`caution`, '대답이 짧게 돌아와도 괜찮아요. 관심을 보인 것만으로 충분합니다.'),
  `setup_guideline` = COALESCE(`setup_guideline`, CAST('{"defaults":{"environment":"community","partnerRole":"peer","intimacyLevel":2,"formalityLevel":2,"partnerGender":"female","partnerAgeGroup":"twenties"},"disabled":{"environment":[],"partnerRole":[],"intimacyLevel":[],"formalityLevel":[],"partnerGender":[],"partnerAgeGroup":[]},"note":null,"recommendedTopics":[],"tags":["동아리","관심사","친해지기"]}' AS JSON))
WHERE `is_template` = 1 AND `title` = '동아리 사람에게 관심사 질문하기';

UPDATE `Missions` SET
  `preparation_tip` = COALESCE(`preparation_tip`, '눈이 마주쳤을 때 건넬 짧은 인사말을 하나 정해두세요.'),
  `caution` = COALESCE(`caution`, '상대가 그냥 지나가도 신경 쓰지 마세요. 인사를 건넨 것 자체가 시도입니다.'),
  `setup_guideline` = COALESCE(`setup_guideline`, CAST('{"defaults":{"environment":"daily_place","partnerRole":"other","intimacyLevel":1,"formalityLevel":3,"partnerGender":"female","partnerAgeGroup":"forties"},"disabled":{"environment":["online"],"partnerRole":[],"intimacyLevel":[],"formalityLevel":[],"partnerGender":[],"partnerAgeGroup":[]},"note":null,"recommendedTopics":[],"tags":["인사","이웃","산책"]}' AS JSON))
WHERE `is_template` = 1 AND `title` = '산책 중 이웃과 가벼운 인사 나누기';

UPDATE `Missions` SET
  `preparation_tip` = COALESCE(`preparation_tip`, '보낼 메시지를 미리 적어두고 한 번 읽어본 뒤 보내면 부담이 줄어요.'),
  `caution` = COALESCE(`caution`, '부담되면 단체 채팅에 짧게 한마디 남기는 것부터 시작하세요.'),
  `setup_guideline` = COALESCE(`setup_guideline`, CAST('{"defaults":{"environment":"school","partnerRole":"peer","intimacyLevel":2,"formalityLevel":2,"partnerGender":"female","partnerAgeGroup":"twenties"},"disabled":{"environment":[],"partnerRole":[],"intimacyLevel":[],"formalityLevel":[],"partnerGender":[],"partnerAgeGroup":[]},"note":null,"recommendedTopics":[],"tags":["팀플","먼저 연락","학교"]}' AS JSON))
WHERE `is_template` = 1 AND `title` = '팀플 조원에게 먼저 연락하기';

UPDATE `Missions` SET
  `preparation_tip` = COALESCE(`preparation_tip`, '왜 참여하고 싶은지 한 문장으로 정리해두면 말을 꺼내기가 훨씬 수월해요.'),
  `caution` = COALESCE(`caution`, '거절당해도 괜찮아요. 시도 자체가 기록됩니다.'),
  `setup_guideline` = COALESCE(`setup_guideline`, CAST('{"defaults":{"environment":"community","partnerRole":"other","intimacyLevel":1,"formalityLevel":3,"partnerGender":"female","partnerAgeGroup":"twenties"},"disabled":{"environment":[],"partnerRole":[],"intimacyLevel":[],"formalityLevel":[],"partnerGender":[],"partnerAgeGroup":[]},"note":null,"recommendedTopics":[],"tags":["모임","제안하기","용기"]}' AS JSON))
WHERE `is_template` = 1 AND `title` = '관심 있는 모임에 참여 의사 밝히기';

UPDATE `Missions` SET
  `preparation_tip` = COALESCE(`preparation_tip`, '대화가 자연스럽게 마무리될 무렵을 노리고, 꺼낼 말을 미리 정해두세요.'),
  `caution` = COALESCE(`caution`, '상대가 망설이면 무리하지 말고 자연스럽게 넘어가세요.'),
  `setup_guideline` = COALESCE(`setup_guideline`, CAST('{"defaults":{"environment":"daily_place","partnerRole":"other","intimacyLevel":2,"formalityLevel":3,"partnerGender":"female","partnerAgeGroup":"twenties"},"disabled":{"environment":[],"partnerRole":[],"intimacyLevel":[],"formalityLevel":[],"partnerGender":[],"partnerAgeGroup":[]},"note":null,"recommendedTopics":[],"tags":["연락처","제안하기","친해지기"]}' AS JSON))
WHERE `is_template` = 1 AND `title` = '새로 알게 된 사람과 연락처 주고받기';
