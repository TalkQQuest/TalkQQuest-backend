// 통합 테스트(`*.integration.test.ts`) 전용 설정.
// 실제 MySQL/Redis가 떠 있어야 돈다 — CI에서는 deploy.yml의 service containers 위에서,
// 로컬에서는 이미 떠 있는 개발 DB를 그대로 쓰면 된다.
//
// 실행: npm run test:integration
/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: "src",
  testMatch: ["**/__tests__/**/*.integration.test.ts"],
  testPathIgnorePatterns: ["/node_modules/"],
  // 실 DB I/O가 섞여 유닛 테스트보다 느리다. 병렬로 여러 통합 테스트가 같은 테이블에
  // 동시에 쓰면 서로 간섭할 수 있어 순차 실행한다.
  maxWorkers: 1,
};
