// 유닛 테스트(기본 `npm test`)용 설정.
// 실제 DB/Redis를 쓰는 통합 테스트(`*.integration.test.ts`)는 여기서 제외하고
// jest.integration.config.js가 따로 돈다 — 유닛 테스트는 인프라 없이 항상 빠르게 돌아야 한다.
/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: "src",
  testMatch: ["**/__tests__/**/*.test.ts"],
  testPathIgnorePatterns: ["/node_modules/", "\\.integration\\.test\\.ts$"],
};
