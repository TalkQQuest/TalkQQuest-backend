// 실제 MySQL 위에서 동시성 처리를 검증하는 통합 테스트.
//
// mission.service.ts의 reserveRefreshSlot은 (user, 날짜, 순번) unique 제약으로 병렬 요청 중
// 하나만 통과시키는데, 이건 jest.mock으로는 절대 검증할 수 없다 — mock은 "함수가 이렇게
// 호출됐다"만 확인할 뿐, 실제 DB가 두 번째 INSERT를 P2002로 거부하는지는 진짜 DB가 있어야 안다.
//
// 실행: npm run test:integration (기본 npm test에는 포함되지 않음)
import { Prisma } from "@prisma/client";
import { prisma } from "../../../config/database";
import { reserveRecommendationLogSlot } from "../repositories/mission.repository";
import { toDateOnly, todayInKst } from "../../../shared/utils/date";

describe("reserveRecommendationLogSlot (integration)", () => {
  // `new Date(); setHours(0,0,0,0)`은 로컬 타임존 자정을 UTC로 직렬화하므로 MySQL DATE
  // 컬럼에 실제 저장되는 값(UTC 자정)과 어긋난다 — 실제로 이 테스트를 처음 작성할 때 이 차이로
  // 저장 직후 조회가 빈 결과를 반환하는 걸 겪었다. 프로덕션 코드(mission.service.ts)가 쓰는
  // toDateOnly/todayInKst로 동일하게 맞춰야 저장·조회가 같은 값을 가리킨다.
  const today = toDateOnly(todayInKst());
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.users.create({ data: { name: "통합테스트 사용자" } });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.recommendation_Logs.deleteMany({ where: { user_id: userId } });
    await prisma.users.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("같은 순번으로 동시에 예약하면 하나만 성공하고 나머지는 P2002로 거부된다", async () => {
    const attempts = 5;
    const results = await Promise.allSettled(
      Array.from({ length: attempts }, () => reserveRecommendationLogSlot(userId, today, 0))
    );

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected"
    );

    // DB의 unique 제약이 실제로 동시 삽입을 하나로 좁혀준다는 것을 검증한다.
    // (mock으로는 이 실패 자체를 재현할 수 없다 — 실제 InnoDB 유니크 인덱스 동작이다.)
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(attempts - 1);
    for (const r of rejected) {
      expect(r.reason).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      expect((r.reason as Prisma.PrismaClientKnownRequestError).code).toBe("P2002");
    }

    const rows = await prisma.recommendation_Logs.findMany({
      where: { user_id: userId, recommended_date: today, refresh_index: 0 },
    });
    expect(rows).toHaveLength(1);
  });
});
