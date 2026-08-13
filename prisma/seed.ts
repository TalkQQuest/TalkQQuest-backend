import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { setupGuidelineSchema } from "../src/modules/mission/dtos/mission.dto";

// 3단계 템플릿 폴백이 고를 후보 미션(is_template=true)을 시드한다.
// 사용자가 만든 미션(is_template=false)은 건드리지 않는다.
// 재실행 안전: title로 찾아 갱신하고, 없을 때만 새로 만든다(행을 지우지 않는다).
//
// 실행: npm run prisma:seed  (내부적으로 tsx prisma/seed.ts)

const prisma = new PrismaClient();

// ── 미션 준비 가이드라인(setup_guideline) ──
// 앱의 대화 설정 4단계가 쓰는 값이다. LLM 생성 미션은 생성 시점에 함께 만들어지지만, 템플릿
// 미션은 여기서 직접 정의한다 — 고정된 큐레이션 미션이라 매번 LLM을 부를 이유가 없고, 값이
// 항상 같아야 화면도 안정적이다.
//
// mission.dto.ts의 setupGuidelineSchema와 형태가 정확히 일치해야 한다. 한 필드라도 빠지면
// 파싱에 실패해 서버가 setupGuideline: null로 응답하므로(조회 자체는 실패하지 않아 조용히
// 비어 보인다), note/recommendedTopics까지 모두 채운다.
// 타입을 여기서 따로 정의하지 않고 setupGuidelineSchema에서 직접 파생한다. 별도로 두면 스키마의
// enum·필수 필드가 바뀌어도 시드가 타입 검사를 그대로 통과해버리고, 어긋난 사실은 런타임에
// "setupGuideline: null"로만 드러난다(조회 자체는 실패하지 않아 조용히 비어 보인다).
type SetupGuideline = z.infer<typeof setupGuidelineSchema>;
type GuidelineDefaults = SetupGuideline["defaults"];
type GuidelineDisabled = SetupGuideline["disabled"];

const NOTHING_DISABLED: GuidelineDisabled = {
  environment: [],
  partnerRole: [],
  intimacyLevel: [],
  formalityLevel: [],
  partnerGender: [],
  partnerAgeGroup: [],
};

// disabled에는 "선택 자체가 성립하지 않는 값"만 담는다. 덜 자연스럽다는 이유로는 막지 않는 것이
// 규칙이라 대부분 빈 배열이고, 필요한 축만 덮어쓴다(llm.service.ts의 SETUP_GUIDELINE_RULES와 동일 기준).
//
// 반환 직전에 실제로 parse까지 한다 — intimacyLevel 1~5 같은 범위 제약은 타입만으로 잡히지
// 않는다. 값이 어긋나면 시드가 그 자리에서 실패하는 편이, 배포 후 화면에서 조용히 비어 보이는
// 것보다 낫다.
const guideline = (
  defaults: GuidelineDefaults,
  tags: string[],
  disabled: Partial<GuidelineDisabled> = {}
): SetupGuideline =>
  setupGuidelineSchema.parse({
    defaults,
    disabled: { ...NOTHING_DISABLED, ...disabled },
    note: null,
    recommendedTopics: [],
    tags,
  });

// 대면으로만 성립하는 미션에서 online을 막는다. 그 외 축은 전부 열어 둔다.
const OFFLINE_ONLY: Partial<GuidelineDisabled> = { environment: ["online"] };

// difficulty: 1=쉬움, 2=보통, 3=어려움
const TEMPLATE_MISSIONS = [
  {
    title: "편의점 점원에게 먼저 인사하기",
    description: "계산할 때 '안녕하세요'라고 먼저 인사를 건네보세요.",
    difficulty: 1,
    estimated_minutes: 5,
    reward_xp: 10,
    category: "짧은 대화",
    preparation_tip: "계산대에 서기 전에 '안녕하세요' 한마디를 속으로 한 번 연습해보세요.",
    caution: "부담되면 눈인사만으로 시작해도 괜찮아요.",
    setup_guideline: guideline(
      {
        environment: "daily_place",
        partnerRole: "other",
        intimacyLevel: 1,
        formalityLevel: 3,
        partnerGender: "female",
        partnerAgeGroup: "twenties",
      },
      ["인사", "짧은 대화", "첫마디"],
      OFFLINE_ONLY
    ),
  },
  {
    title: "카페에서 음료 추천 물어보기",
    description: "주문할 때 점원에게 '오늘 어떤 음료가 인기 있어요?'라고 물어보세요.",
    difficulty: 1,
    estimated_minutes: 5,
    reward_xp: 10,
    category: "짧은 대화",
    preparation_tip: "메뉴판을 미리 훑어보고 궁금한 음료를 하나 정해두면 말을 꺼내기 쉬워요.",
    caution: "점원이 바빠 보이면 짧게 여쭤보고 주문을 마무리해도 충분해요.",
    setup_guideline: guideline(
      {
        environment: "daily_place",
        partnerRole: "other",
        intimacyLevel: 1,
        formalityLevel: 3,
        partnerGender: "female",
        partnerAgeGroup: "twenties",
      },
      ["질문하기", "주문", "짧은 대화"],
      OFFLINE_ONLY
    ),
  },
  {
    title: "옆자리 동기에게 과제 물어보기",
    description: "수업 후 옆자리 사람에게 '오늘 과제 뭐였는지 아세요?'라고 말을 걸어보세요.",
    difficulty: 2,
    estimated_minutes: 10,
    reward_xp: 20,
    category: "학교생활",
    preparation_tip: "수업이 끝나갈 무렵, 물어볼 내용을 한 문장으로 정리해두세요.",
    caution: "상대가 바빠 보이면 다음 기회를 노려도 좋아요.",
    setup_guideline: guideline(
      {
        environment: "school",
        partnerRole: "peer",
        intimacyLevel: 2,
        formalityLevel: 2,
        partnerGender: "female",
        partnerAgeGroup: "twenties",
      },
      ["학교", "질문하기", "동기"],
      OFFLINE_ONLY
    ),
  },
  {
    title: "동아리 사람에게 관심사 질문하기",
    description: "동아리 활동 중 한 사람에게 취미나 관심사를 하나 물어보세요.",
    difficulty: 2,
    estimated_minutes: 10,
    reward_xp: 20,
    category: "친구 만들기",
    preparation_tip: "상대가 좋아할 만한 주제를 한두 개 미리 떠올려두면 대화가 자연스럽게 이어져요.",
    caution: "대답이 짧게 돌아와도 괜찮아요. 관심을 보인 것만으로 충분합니다.",
    // 온라인 동아리 채팅에서도 성립하는 미션이라 막는 축이 없다.
    setup_guideline: guideline(
      {
        environment: "community",
        partnerRole: "peer",
        intimacyLevel: 2,
        formalityLevel: 2,
        partnerGender: "female",
        partnerAgeGroup: "twenties",
      },
      ["동아리", "관심사", "친해지기"]
    ),
  },
  {
    title: "산책 중 이웃과 가벼운 인사 나누기",
    description: "산책하다 마주친 이웃이나 강아지 산책하는 사람에게 가볍게 인사해보세요.",
    difficulty: 2,
    estimated_minutes: 10,
    reward_xp: 20,
    category: "짧은 대화",
    preparation_tip: "눈이 마주쳤을 때 건넬 짧은 인사말을 하나 정해두세요.",
    caution: "상대가 그냥 지나가도 신경 쓰지 마세요. 인사를 건넨 것 자체가 시도입니다.",
    setup_guideline: guideline(
      {
        environment: "daily_place",
        partnerRole: "other",
        intimacyLevel: 1,
        formalityLevel: 3,
        partnerGender: "female",
        partnerAgeGroup: "forties",
      },
      ["인사", "이웃", "산책"],
      OFFLINE_ONLY
    ),
  },
  {
    title: "팀플 조원에게 먼저 연락하기",
    description: "팀 프로젝트 조원에게 먼저 메시지를 보내 일정이나 역할을 물어보세요.",
    difficulty: 3,
    estimated_minutes: 15,
    reward_xp: 30,
    category: "학교생활",
    preparation_tip: "보낼 메시지를 미리 적어두고 한 번 읽어본 뒤 보내면 부담이 줄어요.",
    caution: "부담되면 단체 채팅에 짧게 한마디 남기는 것부터 시작하세요.",
    // 메시지로 먼저 연락하는 미션이라 online이 오히려 자연스럽다.
    setup_guideline: guideline(
      {
        environment: "school",
        partnerRole: "peer",
        intimacyLevel: 2,
        formalityLevel: 2,
        partnerGender: "female",
        partnerAgeGroup: "twenties",
      },
      ["팀플", "먼저 연락", "학교"]
    ),
  },
  {
    title: "관심 있는 모임에 참여 의사 밝히기",
    description: "관심 있던 소모임이나 스터디에 '같이 해도 될까요?'라고 물어보세요.",
    difficulty: 3,
    estimated_minutes: 15,
    reward_xp: 30,
    category: "친구 만들기",
    preparation_tip: "왜 참여하고 싶은지 한 문장으로 정리해두면 말을 꺼내기가 훨씬 수월해요.",
    caution: "거절당해도 괜찮아요. 시도 자체가 기록됩니다.",
    setup_guideline: guideline(
      {
        environment: "community",
        partnerRole: "other",
        intimacyLevel: 1,
        formalityLevel: 3,
        partnerGender: "female",
        partnerAgeGroup: "twenties",
      },
      ["모임", "제안하기", "용기"]
    ),
  },
  {
    title: "새로 알게 된 사람과 연락처 주고받기",
    description: "최근 알게 된 사람에게 '연락처 교환해요'라고 먼저 제안해보세요.",
    difficulty: 3,
    estimated_minutes: 15,
    reward_xp: 30,
    category: "친구 만들기",
    preparation_tip: "대화가 자연스럽게 마무리될 무렵을 노리고, 꺼낼 말을 미리 정해두세요.",
    caution: "상대가 망설이면 무리하지 말고 자연스럽게 넘어가세요.",
    setup_guideline: guideline(
      {
        environment: "daily_place",
        partnerRole: "other",
        intimacyLevel: 2,
        formalityLevel: 3,
        partnerGender: "female",
        partnerAgeGroup: "twenties",
      },
      ["연락처", "제안하기", "친해지기"]
    ),
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

// 템플릿 미션은 **지웠다 다시 만들지 않는다.** Missions는 Conversations·Mission_Records 등에
// onDelete: Cascade로 물려 있어, 데이터가 쌓인 환경에서 delete하면 그 미션으로 진행한 대화
// 기록까지 함께 사라진다(위 seedPlans가 delete를 피한 것과 같은 이유이고, 이쪽은 FK가 Restrict가
// 아니라 Cascade라 막히지도 않고 조용히 지워진다는 점에서 더 위험하다).
//
// title로 찾는다 — 시드 미션에 안정적인 고유 키가 title뿐이다(id는 uuid라 환경마다 다르다).
//
// 이미 있는 행은 **비어 있는 안내 필드만 채우고 나머지는 손대지 않는다.** setup_guideline은
// 운영자가 POST /missions/{id}/setup-guideline/regenerate로 다시 만들 수 있는 값이라, 시드가
// 전체를 덮어쓰면 그렇게 개선해 둔 결과가 시드 재실행 때마다 조용히 사라진다(실제로 그렇게
// 덮어써지는 것을 확인했다). 같은 이유로 백필 마이그레이션도 COALESCE를 쓰므로, 두 경로가
// "기존 값은 덮지 않는다"로 규칙이 같아진다.
//
// 그 대신 시드로 기존 템플릿의 본문(description 등)을 고칠 수는 없다. 본문을 바꿔야 하면
// DB에서 직접 수정하거나 마이그레이션으로 처리한다.
async function seedTemplateMissions() {
  let filled = 0;
  let untouched = 0;
  let created = 0;

  for (const mission of TEMPLATE_MISSIONS) {
    const existing = await prisma.missions.findFirst({
      where: { title: mission.title, is_template: true },
      select: { id: true, preparation_tip: true, caution: true, setup_guideline: true },
    });

    if (!existing) {
      await prisma.missions.create({ data: { ...mission, is_template: true } });
      created += 1;
      continue;
    }

    const fill: {
      preparation_tip?: string | null;
      caution?: string | null;
      setup_guideline?: SetupGuideline;
    } = {};
    if (existing.preparation_tip === null) fill.preparation_tip = mission.preparation_tip;
    if (existing.caution === null) fill.caution = mission.caution;
    if (existing.setup_guideline === null) fill.setup_guideline = mission.setup_guideline;

    if (Object.keys(fill).length === 0) {
      untouched += 1;
      continue;
    }
    await prisma.missions.update({ where: { id: existing.id }, data: fill });
    filled += 1;
  }

  console.log(
    `템플릿 미션 시드 완료: ${created}건 생성, ${filled}건 빈 값 채움, ${untouched}건 변경 없음`
  );
}

async function main() {
  await seedTemplateMissions();
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
