// 통합 테스트 전용 env 로더 + 안전장치.
//
// .env.test가 있으면 그걸로 DATABASE_URL 등을 덮어쓴다(override: true) — config/env.ts가
// 이미 dotenv/config로 .env를 로드해두므로, 그냥 두면 통합 테스트가 개발 DB를 그대로 쓰게 된다.
// CI에서는 .env.test 파일이 없고 워크플로의 env: 블록이 이미 DATABASE_URL을 세팅해두므로,
// 이 로드는 조용히 아무 일도 안 하고 넘어간다(dotenv는 파일이 없으면 에러를 던지지 않는다).
require("dotenv").config({ path: ".env.test", override: true });

// 파일 로드 여부와 무관하게, 최종적으로 결정된 DATABASE_URL이 테스트 DB로 보이는지 검증한다.
// 통합 테스트는 실제로 행을 만들고 지우므로, 실수로 개발/운영 DB를 가리키면 데이터가
// 섞이거나 중간에 죽었을 때 잔여 데이터가 남는다. DB 이름에 "test"가 없으면 아예 실행을 막는다.
const databaseUrl = process.env.DATABASE_URL ?? "";
if (!/test/i.test(databaseUrl)) {
  throw new Error(
    "통합 테스트는 테스트 전용 DB에서만 실행합니다. " +
      "DATABASE_URL의 데이터베이스 이름에 'test'가 포함되어야 합니다. " +
      ".env.test.example을 참고해 .env.test를 만들어주세요."
  );
}
