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

// 이슈 #73: 14종 전부. #5 "먼저 건넨 인사"는 별도 "미션 유형" 필드 없이,
// 기존 Missions.category 중 "짧은 대화"/"일상 대화"를 그대로 묶어서 판정한다(PM 확인 완료).
// condition은 badge/dtos/badge-condition.dto.ts의 BadgeCondition 형태를 따른다.
// icon_url은 실제 디자인 에셋이 없어 임시로 null — 기획/디자인 확정되면 채워 넣으면 된다.
const BADGES = [
  {
    name: "설레는 첫걸음",
    description: "대화 미션을 처음으로 1회 완료",
    condition: { type: "mission_complete_count", target: 1 },
  },
  {
    name: "먼저 건넨 인사",
    description: "'먼저 인사하기' 유형의 미션을 3회 완료",
    condition: {
      type: "mission_complete_count_by_categories",
      categories: ["짧은 대화", "일상 대화"],
      target: 3,
    },
  },
  {
    name: "대화 새싹",
    description: "대화 미션을 누적 5회 완료",
    condition: { type: "mission_complete_count", target: 5 },
  },
  {
    name: "대화 탐험가",
    description: "대화 미션을 누적 15회 완료",
    condition: { type: "mission_complete_count", target: 15 },
  },
  {
    name: "대화 마스터",
    description: "대화 미션을 누적 30회 완료",
    condition: { type: "mission_complete_count", target: 30 },
  },
  {
    name: "새로운 도전",
    description: "서로 다른 유형의 대화 미션을 5종 이상 완료",
    condition: { type: "distinct_mission_category_count", target: 5 },
  },
  {
    name: "꾸준한 대화 습관",
    description: "3일 연속으로 하루 1개 이상의 미션을 완료",
    condition: { type: "mission_streak_days", target: 3 },
  },
  {
    name: "일주일의 변화",
    description: "7일 연속으로 하루 1개 이상의 미션을 완료",
    condition: { type: "mission_streak_days", target: 7 },
  },
  {
    name: "친절한 한마디",
    description: "AI 피드백의 '친절한 태도' 항목에서 80점 이상을 3회 달성",
    condition: { type: "feedback_metric_threshold_count", metric: "kindness", threshold: 80, target: 3 },
  },
  {
    name: "공감의 귀",
    description: "AI 피드백의 '공감 능력' 항목에서 80점 이상을 3회 달성",
    condition: { type: "feedback_metric_threshold_count", metric: "empathy", threshold: 80, target: 3 },
  },
  {
    name: "대화의 리더",
    description: "AI 피드백의 '대화 주도' 항목에서 80점 이상을 3회 달성",
    condition: { type: "feedback_metric_threshold_count", metric: "initiative", threshold: 80, target: 3 },
  },
  {
    name: "질문의 달인",
    description: "AI 피드백의 '질문 연결성' 항목에서 80점 이상을 3회 달성",
    condition: { type: "feedback_metric_threshold_count", metric: "questionLink", threshold: 80, target: 3 },
  },
  {
    name: "균형 잡힌 대화자",
    description: "한 번의 대화에서 모든 항목에서 80점 이상을 4회 달성",
    condition: { type: "feedback_all_metrics_threshold_count", threshold: 80, target: 4 },
  },
  {
    name: "피드백 수집가",
    description: "AI 대화 피드백 결과를 누적 10회 확인",
    condition: { type: "feedback_created_count", target: 10 },
  },
];

async function seedBadges() {
  for (const badge of BADGES) {
    const existing = await prisma.badges.findFirst({ where: { name: badge.name } });
    if (existing) {
      await prisma.badges.update({ where: { id: existing.id }, data: badge });
    } else {
      await prisma.badges.create({ data: badge });
    }
  }
  console.log(`뱃지 시드 완료: ${BADGES.length}건`);
}

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
  await seedBadges();
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
