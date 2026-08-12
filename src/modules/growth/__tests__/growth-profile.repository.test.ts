import { Prisma } from "@prisma/client";
import { saveGrowthProfile } from "../repositories/growth-profile.repository";

// metric_averages 등 Json? 컬럼에 JS null을 그대로 넘기면 Prisma가 "SQL NULL을 원하는지
// JSON 리터럴 null을 원하는지" 구분하지 못해 런타임에 거부한다(Prisma.JsonNull vs Prisma.DbNull).
// computeMetricAverages는 표본이 전부 비어 있으면 null을 반환하므로, 이 경로가 실제로 발생한다.
describe("saveGrowthProfile — Json 컬럼 null 변환", () => {
  const baseData = {
    summary: null,
    strengths: [] as unknown,
    improvements: [] as unknown,
    struggleSituations: [] as unknown,
    metricAverages: null as unknown,
    suggestedDifficulty: null,
    reflectedFeedbackCount: 3,
    lastFeedbackId: "f1",
    lastReflectedAt: new Date("2026-08-05T10:00:00Z"),
  };

  const fakeTx = () => {
    const update = jest.fn().mockResolvedValue({});
    return { tx: { user_Growth_Profiles: { update } } as never, update };
  };

  it("metric_averages가 null이면 Prisma.DbNull로 변환해 전달한다", async () => {
    const { tx, update } = fakeTx();

    await saveGrowthProfile(tx, "u1", baseData);

    const [call] = update.mock.calls;
    expect(call[0].data.metric_averages).toBe(Prisma.DbNull);
  });

  it("값이 있으면 그대로 전달한다", async () => {
    const { tx, update } = fakeTx();
    const metricAverages = { kindness: { avg: 70, trend: "flat" } };

    await saveGrowthProfile(tx, "u1", { ...baseData, metricAverages });

    const [call] = update.mock.calls;
    expect(call[0].data.metric_averages).toEqual(metricAverages);
  });

  it("빈 배열은 DbNull로 바뀌지 않는다 (null과 빈 배열은 다른 상태)", async () => {
    const { tx, update } = fakeTx();

    await saveGrowthProfile(tx, "u1", { ...baseData, struggleSituations: [] });

    const [call] = update.mock.calls;
    expect(call[0].data.struggle_situations).toEqual([]);
  });

  it("스칼라 필드(summary·suggested_difficulty)는 null을 그대로 둔다", async () => {
    const { tx, update } = fakeTx();

    await saveGrowthProfile(tx, "u1", baseData);

    const [call] = update.mock.calls;
    expect(call[0].data.summary).toBeNull();
    expect(call[0].data.suggested_difficulty).toBeNull();
  });
});
