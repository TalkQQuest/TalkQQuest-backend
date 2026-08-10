import { daysBetween, durationMinutes, formatDuration, fromDateOnly, toDateOnly, todayInKst } from "../date";

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

describe("formatDuration", () => {
  it("종료 시각이 없으면 null (진행 중 대화)", () => {
    expect(formatDuration(new Date("2026-07-25T10:00:00Z"), null)).toBeNull();
  });

  it("mm:ss 형식으로 반환하고, 분/초 모두 2자리로 0을 채운다", () => {
    const start = new Date("2026-07-25T10:00:00Z");
    expect(formatDuration(start, new Date("2026-07-25T10:12:34Z"))).toBe("12:34");
    expect(formatDuration(start, new Date("2026-07-25T10:00:05Z"))).toBe("00:05");
  });

  it("초 단위는 버림 처리한다(반올림 아님)", () => {
    const start = new Date("2026-07-25T10:00:00Z");
    // 5분 59.9초 → 05:59 (06:00으로 올림되지 않음)
    expect(formatDuration(start, new Date("2026-07-25T10:05:59.900Z"))).toBe("05:59");
  });

  it("음수(비정상 순서)는 00:00으로 막는다", () => {
    const start = new Date("2026-07-25T10:05:00Z");
    expect(formatDuration(start, new Date("2026-07-25T10:00:00Z"))).toBe("00:00");
  });
});

describe("todayInKst", () => {
  it("UTC 자정 직후는 이미 KST로 같은 날 오전 9시라 날짜가 같다", () => {
    expect(todayInKst(new Date("2026-07-27T00:30:00Z"))).toBe("2026-07-27");
  });

  it("UTC 기준 전날 늦은 밤은 KST로는 다음 날이다", () => {
    // UTC 7/26 15:00 = KST 7/27 00:00 → 서버가 UTC여도 사용자 기준 하루는 7/27
    expect(todayInKst(new Date("2026-07-26T15:00:00Z"))).toBe("2026-07-27");
    expect(todayInKst(new Date("2026-07-26T14:59:59Z"))).toBe("2026-07-26");
  });
});

describe("toDateOnly / fromDateOnly", () => {
  it("YYYY-MM-DD ↔ UTC 자정 Date로 서로 되돌릴 수 있다", () => {
    expect(toDateOnly("2026-07-27").toISOString()).toBe("2026-07-27T00:00:00.000Z");
    expect(fromDateOnly(new Date("2026-07-27T00:00:00.000Z"))).toBe("2026-07-27");
  });
});

describe("daysBetween", () => {
  it("같은 날은 0, 다음 날은 1, 전날은 -1", () => {
    expect(daysBetween("2026-07-27", "2026-07-27")).toBe(0);
    expect(daysBetween("2026-07-28", "2026-07-27")).toBe(1);
    expect(daysBetween("2026-07-26", "2026-07-27")).toBe(-1);
  });

  it("월·연 경계를 넘어도 일수로 계산한다", () => {
    expect(daysBetween("2026-08-01", "2026-07-31")).toBe(1);
    expect(daysBetween("2027-01-01", "2026-12-31")).toBe(1);
  });
});
