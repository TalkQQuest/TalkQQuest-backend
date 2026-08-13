// modules/mission/repositories/mission.repository.ts
import {
  MissionEnvironment,
  MissionPartnerAgeGroup,
  MissionPartnerGender,
  MissionPartnerRole,
  PersonalityType,
  Prisma,
  PrepItemType,
  RecommendationSource,
} from "@prisma/client";
import { prisma } from "../../../config/database";
import { MissionOrigin } from "../dtos/mission.constants";
import * as missionRepository from "../../mission/repositories/mission.repository";

// 미션 목록에 어떤 미션이 보여야 하는지 결정하는 기준.
export interface MissionVisibility {
  userId: string;
  personalityType: PersonalityType | null;
  origin?: MissionOrigin;
}

// 미션 목록의 공개 범위 필터.
//  - 템플릿 미션: 모두에게 공개
//  - 내가 만든 AI 미션: 수행 여부와 무관하게 항상 (오늘 받은 미션이 목록에서 사라지면 안 되므로)
//  - 남이 만든 AI 미션: 나와 성향이 같고 실제로 수행된 적이 있는 것만
//
// 내 미션은 "내 것" 조건과 "성향이 같은 사용자" 조건에 동시에 걸릴 수 있지만 OR이라 중복 행은
// 생기지 않는다. 성향 정보가 없으면(온보딩 전) 유사 성향 조건 자체를 빼는데, null로 매칭하면
// 성향이 기록되지 않은 과거 미션이 전부 딸려오기 때문이다.
// report 도메인(growth/weekly-compare 진행률 계산)에서도 "이 사용자에게 보이는 미션" 기준을
// 동일하게 써야 하므로 export한다(#201) — GET /missions와 다른 기준으로 세면 숫자가 어긋난다.
export const buildVisibilityWhere = (visibility: MissionVisibility): Prisma.MissionsWhereInput => {
  const template: Prisma.MissionsWhereInput = { is_template: true };
  const mine: Prisma.MissionsWhereInput = {
    is_template: false,
    created_by_user_id: visibility.userId,
  };
  const similarPerformed: Prisma.MissionsWhereInput[] = visibility.personalityType
    ? [
        {
          is_template: false,
          creator_personality_type: visibility.personalityType,
          mission_records: { some: {} },
        },
      ]
    : [];

  if (visibility.origin === "template") return template;
  if (visibility.origin === "ai") return { OR: [mine, ...similarPerformed] };
  return { OR: [template, mine, ...similarPerformed] };
};

const buildMissionWhere = (params: {
  difficulty?: number;
  category?: string;
  visibility: MissionVisibility;
}): Prisma.MissionsWhereInput => ({
  ...(params.difficulty !== undefined && { difficulty: params.difficulty }),
  ...(params.category && { category: params.category }),
  ...buildVisibilityWhere(params.visibility),
});

export const findMissions = (params: {
  difficulty?: number;
  category?: string;
  visibility: MissionVisibility;
  page: number;
  size: number;
}) =>
  prisma.missions.findMany({
    where: buildMissionWhere(params),
    orderBy: { created_at: "desc" },
    skip: (params.page - 1) * params.size,
    take: params.size,
  });

export const countMissions = (params: {
  difficulty?: number;
  category?: string;
  visibility: MissionVisibility;
}) => prisma.missions.count({ where: buildMissionWhere(params) });

export const findMissionById = (missionId: string) =>
  prisma.missions.findUnique({ where: { id: missionId } });

// 단건 조회에도 목록과 같은 공개 범위를 적용한다.
// id만으로 찾으면 범위 밖(남이 만든, 아직 수행된 적 없는 AI 미션)의 내용을 그대로 읽을 수 있고,
// prep의 경우 LLM 생성까지 유발한다. 범위 밖이면 null → 호출부가 404로 응답한다.
export const findVisibleMissionById = (missionId: string, visibility: MissionVisibility) =>
  prisma.missions.findFirst({
    where: { id: missionId, ...buildVisibilityWhere(visibility) },
  });

export const findSavedMissionIds = (userId: string, missionIds: string[]) =>
  prisma.mission_Saves.findMany({
    where: { user_id: userId, mission_id: { in: missionIds } },
    select: { mission_id: true },
  });

// 아카이브 요약(missionRecordCount)이 "완료 기록 수"에서 "북마크한 미션 수" 기준으로 바뀌면서 필요해짐 (#86).
export const countSavedMissions = (userId: string) =>
  prisma.mission_Saves.count({ where: { user_id: userId } });

export const findSavedMission = (userId: string, missionId: string) =>
  prisma.mission_Saves.findUnique({
    where: { user_id_mission_id: { user_id: userId, mission_id: missionId } },
  });

// 아카이브 저장 목록 조회용
export const findSavedMissions = (params: {
  userId: string;
  startDate?: Date;
  endDate?: Date;
  sort: "asc" | "desc";
}) =>
  prisma.mission_Saves.findMany({
    where: {
      user_id: params.userId,
      ...(params.startDate || params.endDate
        ? {
            created_at: {
              ...(params.startDate && { gte: params.startDate }),
              ...(params.endDate && { lte: params.endDate }),
            },
          }
        : {}),
    },
    include: {
      mission: {
        select: {
          id: true,
          title: true,
          category: true,
          difficulty: true,
          estimated_minutes: true,
          reward_xp: true,
        },
      },
    },
    orderBy: {
      created_at: params.sort,
    },
  });

// 유저의 최신 mission_Record 조회 (완료 여부 판단용)
export const findLatestMissionRecordsByMissionIds = (userId: string, missionIds: string[]) =>
  prisma.mission_Records.findMany({
    where: { user_id: userId, mission_id: { in: missionIds } },
    orderBy: { created_at: "desc" },
    select: { id: true, mission_id: true, status: true },
  });

export const createMissionSave = (userId: string, missionId: string) =>
  prisma.mission_Saves.create({ data: { user_id: userId, mission_id: missionId } });

export const deleteMissionSave = (userId: string, missionId: string) =>
  prisma.mission_Saves.delete({
    where: { user_id_mission_id: { user_id: userId, mission_id: missionId } },
  });

export const findPrepItems = (missionId: string) =>
  prisma.mission_Prep_Items.findMany({
    where: { mission_id: missionId },
    orderBy: { order_index: "asc" },
  });

export const findPrepItemsByType = (missionId: string, type: PrepItemType) =>
  prisma.mission_Prep_Items.findMany({
    where: { mission_id: missionId, type },
    orderBy: { order_index: "asc" },
  });

// 표시 개수를 못 채우는 부분 캐시를 다시 만들 때 쓴다.
// order_index가 겹치면 unique 제약에 걸리므로 새로 넣기 전에 비워야 한다.
export const deletePrepItemsByType = (missionId: string, type: PrepItemType) =>
  prisma.mission_Prep_Items.deleteMany({ where: { mission_id: missionId, type } });

// 생성한 첫 마디 후보를 캐시해 둔다. 미션당 1회만 만들고 이후에는 재사용한다.
export const createPrepItems = (
  missionId: string,
  type: PrepItemType,
  contents: string[]
) =>
  prisma.mission_Prep_Items.createMany({
    data: contents.map((content, index) => ({
      mission_id: missionId,
      type,
      content,
      order_index: index,
    })),
    // 동시 요청이 모두 빈 캐시를 읽고 같은 미션에 후보를 두 벌 넣는 것을 막는다.
    // (mission_id, type, order_index) unique 제약과 짝이다 — 늦은 쪽은 조용히 버려지고,
    // 호출부가 곧바로 다시 조회하므로 먼저 들어간 한 벌을 그대로 쓴다.
    skipDuplicates: true,
  });

// ── 대화 플레이북 (Mission_Playbooks) ──
// 임베딩 때문에 1MB를 넘길 수 있어 Missions와 분리된 테이블이다. 여기서만 다룬다.

export const findPlaybookByMissionId = (missionId: string) =>
  prisma.mission_Playbooks.findUnique({
    where: { mission_id: missionId },
    select: { data: true, updated_at: true },
  });

// 같은 미션으로 동시에 대화를 시작하면 둘 다 생성할 수 있어 upsert로 받는다.
export const upsertPlaybook = (missionId: string, data: unknown) =>
  prisma.mission_Playbooks.upsert({
    where: { mission_id: missionId },
    create: { mission_id: missionId, data: data as never },
    update: { data: data as never },
  });

// 삭제해도 다음 대화 시작 시 자동 재생성된다(ensureMissionPlaybook).
export const deletePlaybook = (missionId: string) =>
  prisma.mission_Playbooks.deleteMany({ where: { mission_id: missionId } });

// ── 미션 준비 정보 (Mission_Setups) — #152 ──
// Missions.setup_guideline은 여기서 절대 쓰지 않는다. 그건 미션 하나당 1벌, 여러 사용자가
// 공유하는 정적 가이드라인(#148-150)이고, Mission_Setups는 그걸 참고해서 사용자가 고른
// 대화 1회짜리 개인 설정이다 — 정보는 가이드라인 → 사용자 설정으로만 흐르고 반대로 쓰지 않는다.

// GET /missions/today의 추천 결과는 Recommendation_Logs 캐시에서 오므로, 가이드라인은
// missionId로 Missions을 다시 조회해야 얻을 수 있다.
export const findMissionSetupGuideline = (missionId: string) =>
  prisma.missions.findUnique({
    where: { id: missionId },
    select: { setup_guideline: true },
  });

export const createMissionSetup = (
  userId: string,
  missionId: string,
  data: {
    environment: MissionEnvironment;
    partnerRole: MissionPartnerRole;
    partnerGender: MissionPartnerGender;
    partnerAgeGroup: MissionPartnerAgeGroup;
    intimacyLevel: number;
    formalityLevel: number;
  }
) =>
  prisma.mission_Setups.create({
    data: {
      user_id: userId,
      mission_id: missionId,
      environment: data.environment,
      partner_role: data.partnerRole,
      partner_gender: data.partnerGender,
      partner_age_group: data.partnerAgeGroup,
      intimacy_level: data.intimacyLevel,
      formality_level: data.formalityLevel,
    },
  });

// ── AI 미션 추천 파이프라인용 조회 (recommendation/difficulty/template.service) ──

export const findUserProfileByUserId = (userId: string) =>
  prisma.user_Profiles.findUnique({ where: { user_id: userId } });

// 미션 목록의 유사 성향 필터·AI 미션 생성 시 성향 기록용. 프로필 전체가 필요 없는 자리라
// 컬럼 하나만 읽는다. 프로필이 없으면(온보딩 전) null.
export const findUserPersonalityType = async (userId: string): Promise<PersonalityType | null> => {
  const profile = await prisma.user_Profiles.findUnique({
    where: { user_id: userId },
    select: { personality_type: true },
  });
  return profile?.personality_type ?? null;
};

export const findActiveGoalsByUserId = (userId: string) =>
  prisma.goals.findMany({
    where: { user_id: userId, is_active: true },
    orderBy: { created_at: "desc" },
  });

// 최근 수행 기록 N건을 미션 메타(제목/카테고리/난이도)와 조인해 최신순으로 조회.
// 난이도 조정·회피 유형 판단은 최근 몇 건만 보므로 take로 제한합니다.
export const findRecentMissionRecords = (userId: string, limit: number) =>
  prisma.mission_Records.findMany({
    where: { user_id: userId },
    include: {
      mission: { select: { id: true, title: true, category: true, difficulty: true } },
    },
    orderBy: { created_at: "desc" },
    take: limit,
  });

// 3단계 템플릿 폴백용. is_template=true 미션을 가져오고,
// 난이도 근접·관심사 매칭 같은 랭킹은 서비스(순수 함수)에서 처리합니다.
//
// #150 — 회피 카테고리 제외 인자를 뺐다. 그 목록은 Mission_Records.result 기반이었는데
// result에는 항상 success가 들어와 한 번도 채워지지 않았다(항상 빈 배열이라 무조건 전체 조회).
export const findTemplateMissions = () =>
  prisma.missions.findMany({
    where: { is_template: true },
    orderBy: { created_at: "asc" },
  });

// 새로고침 슬롯 선점. LLM을 부르기 전에 (user, 날짜, 순번)으로 빈 로그 행을 만든다.
// 같은 순번을 노린 동시 요청은 unique 제약에 걸려 P2002로 떨어지므로, count를 읽고
// 판단하는 방식과 달리 병렬 요청이 하루 한도를 함께 통과하지 못한다.
// 추천 결과는 이후 updateRecommendationLog로 이 행에 채운다.
export const reserveRecommendationLogSlot = (
  userId: string,
  recommendedDate: Date,
  refreshIndex: number
) =>
  prisma.recommendation_Logs.create({
    data: {
      user_id: userId,
      // 실제 출처는 추천이 끝난 뒤 갱신된다. 예약 단계에서는 아직 알 수 없다.
      source: "fallback",
      parse_success: false,
      recommended_date: recommendedDate,
      refresh_index: refreshIndex,
    },
    select: { id: true },
  });

// 예약해 둔 로그 행에 추천 결과를 채운다 (품질 개선·오류 추적용).
// Json 컬럼 중 null이 될 수 있는 prompt_input만 DbNull로 변환한다.
export const updateRecommendationLog = (
  logId: string,
  data: {
    source: RecommendationSource;
    llmModel: string | null;
    targetDifficulty: number | null;
    // #150 — 더 이상 계산하지 않아 항상 null이 들어온다. 컬럼은 과거 로그 해석용으로 남긴다.
    avoidedCategories: string[] | null;
    promptInput: unknown | null;
    rawResponse: string | null;
    parseSuccess: boolean;
    recommendedMission: unknown;
    fallbackReason: string | null;
  }
) =>
  prisma.recommendation_Logs.update({
    where: { id: logId },
    data: {
      source: data.source,
      llm_model: data.llmModel,
      target_difficulty: data.targetDifficulty,
      avoided_categories:
        data.avoidedCategories === null
          ? Prisma.DbNull
          : (data.avoidedCategories as unknown as Prisma.InputJsonValue),
      prompt_input:
        data.promptInput === null ? Prisma.DbNull : (data.promptInput as Prisma.InputJsonValue),
      raw_response: data.rawResponse,
      parse_success: data.parseSuccess,
      recommended_mission: data.recommendedMission as Prisma.InputJsonValue,
      fallback_reason: data.fallbackReason,
    },
  });

// 오늘의 미션 캐시용 — 해당 날짜에 마지막으로 뽑은 추천 1건.
// 새로고침하면 로그가 여러 건 쌓이므로 가장 최근 것이 "현재 오늘의 미션"이다.
// refresh_index를 우선 기준으로 삼는다. 예약과 결과 갱신이 나뉘어 있어 created_at만으로는
// 동시 요청 시 순서가 뒤집힐 수 있고, 이 컬럼 이전 로그(null)는 뒤로 밀려야 하기 때문이다.
export const findLatestRecommendationLogByDate = (userId: string, recommendedDate: Date) =>
  prisma.recommendation_Logs.findFirst({
    where: { user_id: userId, recommended_date: recommendedDate },
    // id까지 보는 이유: refresh_index가 null인 과거 로그끼리는 위 두 기준이 모두 같을 수 있고
    // (created_at은 밀리초 정밀도), 그러면 어느 행이 나올지 보장되지 않는다.
    orderBy: [{ refresh_index: "desc" }, { created_at: "desc" }, { id: "desc" }],
  });

// 해당 날짜에 뽑은 추천 건수. 첫 생성 1건을 뺀 나머지가 사용한 새로고침 횟수다.
export const countRecommendationLogsByDate = (userId: string, recommendedDate: Date) =>
  prisma.recommendation_Logs.count({
    where: { user_id: userId, recommended_date: recommendedDate },
  });

// POST /missions/from-recommendation용. 로그가 본인 것인지 함께 확인한다.
export const findRecommendationLogByIdAndUser = (logId: string, userId: string) =>
  prisma.recommendation_Logs.findFirst({ where: { id: logId, user_id: userId } });

// llm/fallback 추천(원본이 Recommendation_Logs.recommended_mission에만 있던 것)을
// 실제 Missions 행으로 저장한다. is_template=false로 만들어 관리자 템플릿과 구분하고,
// 생성자와 그 시점의 성향을 함께 남겨 미션 목록의 유사 성향 필터가 쓸 수 있게 한다.
export const createMissionFromRecommendation = (data: {
  title: string;
  description: string;
  difficulty: number;
  estimatedMinutes: number;
  rewardXp: number;
  category: string;
  setupGuideline: unknown | null;
  createdByUserId: string;
  creatorPersonalityType: PersonalityType | null;
}) =>
  prisma.missions.create({
    data: {
      title: data.title,
      description: data.description,
      difficulty: data.difficulty,
      estimated_minutes: data.estimatedMinutes,
      reward_xp: data.rewardXp,
      category: data.category,
      setup_guideline:
        data.setupGuideline === null
          ? Prisma.DbNull
          : (data.setupGuideline as Prisma.InputJsonValue),
      is_template: false,
      created_by_user_id: data.createdByUserId,
      creator_personality_type: data.creatorPersonalityType,
    },
  });

// 저장 완료 후 로그에 생성된 mission_id를 백링크해 재요청 시 중복 생성을 막는다.
export const markRecommendationLogMissionCreated = (logId: string, missionId: string) =>
  prisma.recommendation_Logs.update({
    where: { id: logId },
    data: { created_mission_id: missionId },
  });

// 추천 로그 1건에 대해 실제 Missions 행을 "정확히 하나만" 만든다.
//
// 백링크를 읽고 → 미션을 만들고 → 백링크를 쓰는 순서로는, 병렬 요청이 모두 null을 읽고
// 각자 미션을 만든 뒤 같은 로그를 덮어쓴다. 마지막 쓰기만 남으므로 나머지 미션은 아무도
// 가리키지 않는 채 목록에만 쌓인다(재시도·중복 탭이면 그대로 재현된다).
//
// 그래서 백링크 쓰기를 "아직 비어 있을 때만" 성공하는 조건부 갱신으로 만들고, 그 결과로
// 승자를 가린다. updateMany의 WHERE가 행 잠금 아래에서 평가되므로 승자는 하나뿐이다.
// 진 요청은 방금 만든 미션을 지우고 승자의 미션 id를 쓴다.
export const createMissionForRecommendationLog = (
  logId: string,
  data: {
    title: string;
    description: string;
    difficulty: number;
    estimatedMinutes: number;
    rewardXp: number;
    category: string;
    setupGuideline: unknown | null;
    createdByUserId: string;
    creatorPersonalityType: PersonalityType | null;
  }
) =>
  prisma.$transaction(async (tx) => {
    const existing = await tx.recommendation_Logs.findUnique({
      where: { id: logId },
      select: { created_mission_id: true },
    });
    if (existing?.created_mission_id) return existing.created_mission_id;

    const mission = await tx.missions.create({
      data: {
        title: data.title,
        description: data.description,
        difficulty: data.difficulty,
        estimated_minutes: data.estimatedMinutes,
        reward_xp: data.rewardXp,
        category: data.category,
        setup_guideline:
          data.setupGuideline === null
            ? Prisma.DbNull
            : (data.setupGuideline as Prisma.InputJsonValue),
        is_template: false,
        created_by_user_id: data.createdByUserId,
        creator_personality_type: data.creatorPersonalityType,
      },
      select: { id: true },
    });

    const claimed = await tx.recommendation_Logs.updateMany({
      where: { id: logId, created_mission_id: null },
      data: { created_mission_id: mission.id },
    });
    if (claimed.count === 1) return mission.id;

    // 여기까지 왔다는 건 경합에서 졌거나(다른 요청이 먼저 백링크를 채움) 로그가 사라졌다는 뜻이다.
    // 내가 만든 미션은 아무도 가리키지 않으므로 되돌린다.
    await tx.missions.delete({ where: { id: mission.id } });

    // 승자 값을 반드시 **잠금 읽기**로 가져온다. REPEATABLE READ에서 일반 조회는 트랜잭션
    // 시작 시점 스냅샷을 보므로, 위 updateMany가 갱신을 감지했더라도 여기서는 여전히 null이
    // 보인다. 그대로 반환하면 호출부가 존재하지 않는 미션 id를 받는다.
    const [winner] = await tx.$queryRaw<{ created_mission_id: string | null }[]>`
      SELECT created_mission_id FROM Recommendation_Logs WHERE id = ${logId} FOR UPDATE
    `;
    if (!winner?.created_mission_id) {
      // 로그가 없거나(잘못된 logId) 백링크가 비어 있으면 돌려줄 미션이 없다.
      // 조용히 null을 흘리는 대신 실패로 드러내 재시도할 수 있게 한다.
      throw new Error(`추천 로그(${logId})에 연결된 미션을 찾지 못했습니다.`);
    }
    return winner.created_mission_id;
  });
