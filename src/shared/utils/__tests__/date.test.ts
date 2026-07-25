import { durationMinutes } from "../date";

describe("durationMinutes", () => {
  it("종료 시각이 없으면 null (진행 중 대화)", () => {
    expect(durationMinutes(new Date("2026-07-25T10:00:00Z"), null)).toBeNull();
  });

  it("종료 - 시작을 분으로 반올림한다", () => {
    const start = new Date("2026-07-25T10:00:00Z");
    expect(durationMinutes(start, new Date("2026-07-25T10:05:00Z"))).toBe(5);
    // 5분 40초 → 6분(반올림)
    expect(durationMinutes(start, new Date("2026-07-25T10:05:40Z"))).toBe(6);
  });

  it("음수(비정상 순서)는 0으로 막는다", () => {
    const start = new Date("2026-07-25T10:05:00Z");
    expect(durationMinutes(start, new Date("2026-07-25T10:00:00Z"))).toBe(0);
  });
});
