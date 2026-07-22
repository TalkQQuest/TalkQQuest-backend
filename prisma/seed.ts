import { PrismaClient } from "@prisma/client";

// 3단계 템플릿 폴백이 고를 후보 미션(is_template=true)을 시드한다.
// 사용자가 만든 미션(is_template=false)은 건드리지 않는다.
// 재실행 안전: 기존 템플릿을 지우고 다시 넣는다(idempotent).
//
// 실행: npm run prisma:seed  (내부적으로 tsx prisma/seed.ts)

const prisma = new PrismaClient();

// difficulty: 1=쉬움, 2=보통, 3=어려움
const TEMPLATE_MISSIONS = [
  {
    title: "편의점 점원에게 먼저 인사하기",
    description: "계산할 때 '안녕하세요'라고 먼저 인사를 건네보세요.",
    difficulty: 1,
    estimated_minutes: 5,
    reward_xp: 10,
    category: "짧은 대화",
    caution: "부담되면 눈인사만으로 시작해도 괜찮아요.",
  },
  {
    title: "카페에서 음료 추천 물어보기",
    description: "주문할 때 점원에게 '오늘 어떤 음료가 인기 있어요?'라고 물어보세요.",
    difficulty: 1,
    estimated_minutes: 5,
    reward_xp: 10,
    category: "짧은 대화",
    caution: null,
  },
  {
    title: "옆자리 동기에게 과제 물어보기",
    description: "수업 후 옆자리 사람에게 '오늘 과제 뭐였는지 아세요?'라고 말을 걸어보세요.",
    difficulty: 2,
    estimated_minutes: 10,
    reward_xp: 20,
    category: "학교생활",
    caution: "상대가 바빠 보이면 다음 기회를 노려도 좋아요.",
  },
  {
    title: "동아리 사람에게 관심사 질문하기",
    description: "동아리 활동 중 한 사람에게 취미나 관심사를 하나 물어보세요.",
    difficulty: 2,
    estimated_minutes: 10,
    reward_xp: 20,
    category: "친구 만들기",
    caution: null,
  },
  {
    title: "산책 중 이웃과 가벼운 인사 나누기",
    description: "산책하다 마주친 이웃이나 강아지 산책하는 사람에게 가볍게 인사해보세요.",
    difficulty: 2,
    estimated_minutes: 10,
    reward_xp: 20,
    category: "짧은 대화",
    caution: null,
  },
  {
    title: "팀플 조원에게 먼저 연락하기",
    description: "팀 프로젝트 조원에게 먼저 메시지를 보내 일정이나 역할을 물어보세요.",
    difficulty: 3,
    estimated_minutes: 15,
    reward_xp: 30,
    category: "학교생활",
    caution: "부담되면 단체 채팅에 짧게 한마디 남기는 것부터 시작하세요.",
  },
  {
    title: "관심 있는 모임에 참여 의사 밝히기",
    description: "관심 있던 소모임이나 스터디에 '같이 해도 될까요?'라고 물어보세요.",
    difficulty: 3,
    estimated_minutes: 15,
    reward_xp: 30,
    category: "친구 만들기",
    caution: "거절당해도 괜찮아요. 시도 자체가 기록됩니다.",
  },
  {
    title: "새로 알게 된 사람과 연락처 주고받기",
    description: "최근 알게 된 사람에게 '연락처 교환해요'라고 먼저 제안해보세요.",
    difficulty: 3,
    estimated_minutes: 15,
    reward_xp: 30,
    category: "친구 만들기",
    caution: "상대가 망설이면 무리하지 말고 자연스럽게 넘어가세요.",
  },
];

// 무료/프리미엄 등급. 실제 PG 연동 전이라 POST /plans API 없이 여기서만 관리한다.
// Plans.name에 unique 제약이 없어 delete+recreate 대신 name으로 찾아 upsert한다 —
// Subscriptions가 이미 특정 plan_id를 참조 중이면 delete가 FK(Restrict)에 걸리기 때문.
const PLANS = [
  {
    name: "free",
    price: 0,
    currency: "KRW",
    ai_limit: 5,
    feedback_limit: 3,
    features: ["기본 미션", "AI 피드백 5회"],
  },
  {
    name: "premium",
    price: 9900,
    currency: "KRW",
    ai_limit: null,
    feedback_limit: null,
    features: ["무제한 미션", "AI 피드백 무제한", "월간 리포트"],
  },
];

async function seedPlans() {
  for (const plan of PLANS) {
    const existing = await prisma.plans.findFirst({ where: { name: plan.name } });
    if (existing) {
      await prisma.plans.update({ where: { id: existing.id }, data: plan });
    } else {
      await prisma.plans.create({ data: plan });
    }
  }
  console.log(`플랜 시드 완료: ${PLANS.length}건 (free/premium)`);
}

async function main() {
  const deleted = await prisma.missions.deleteMany({ where: { is_template: true } });
  const created = await prisma.missions.createMany({
    data: TEMPLATE_MISSIONS.map((m) => ({ ...m, is_template: true })),
  });
  console.log(`템플릿 미션 시드 완료: ${deleted.count}건 삭제, ${created.count}건 생성`);

  await seedPlans();
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
