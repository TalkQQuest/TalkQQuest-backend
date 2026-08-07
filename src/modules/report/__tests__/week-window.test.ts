import { getCompletedWeekCount, getSignupWeekRange } from "../services/week-window";

describe("getCompletedWeekCount", () => {
  const signupAt = new Date("2026-08-01T00:00:00.000Z");

  it("가입 후 7일 미만이면 0 (아직 1주차도 안 끝남)", () => {
    expect(getCompletedWeekCount(signupAt, new Date("2026-08-07T23:59:59.000Z"))).toBe(0);
  });

  it("정확히 7일이 지나면 1주차가 완결된다", () => {
    expect(getCompletedWeekCount(signupAt, new Date("2026-08-08T00:00:00.000Z"))).toBe(1);
  });

  it("14일이 지나면 2주차까지 완결된다", () => {
    expect(getCompletedWeekCount(signupAt, new Date("2026-08-15T00:00:00.000Z"))).toBe(2);
  });

  it("6주(42일)가 지나면 6주차까지 완결된다", () => {
    expect(getCompletedWeekCount(signupAt, new Date("2026-09-12T00:00:00.000Z"))).toBe(6);
  });
});

describe("getSignupWeekRange", () => {
  const signupAt = new Date("2026-08-01T00:00:00.000Z");

  it("1주차는 가입일 그 순간부터 7일간이다", () => {
    const { start, end } = getSignupWeekRange(signupAt, 1);
    expect(start.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-08-08T00:00:00.000Z");
  });

  it("4주차는 가입일로부터 21~28일 구간이다", () => {
    const { start, end } = getSignupWeekRange(signupAt, 4);
    expect(start.toISOString()).toBe("2026-08-22T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-08-29T00:00:00.000Z");
  });
});
