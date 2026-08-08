# 미션 준비 정보 전체 흐름 — 미션 생성 → 대화 → 피드백

> 관련 문서: [mission-setup-guideline.md](mission-setup-guideline.md), [mission-recommendation-history-based.md](mission-recommendation-history-based.md)
> 이 문서는 `Mission_Setups`를 어디서 만들고 어디까지 흘려보낼지, 각 단계에서 ERD를 어떻게 잡을지 정리합니다.

## 계층 원칙 (확정)

세 계층의 책임을 이렇게 나눕니다. **아래 모든 설계 판단이 이 원칙에서 파생됩니다.**

| 계층 | 담는 것 | 범위 | 공유 여부 |
| --- | --- | --- | --- |
| `Missions` | 환경·상대에 무관한 **객관적 상황** | 미션 1건 | 여러 사용자가 공유 |
| `Mission_Playbooks` | 그 객관적 상황의 **세부 단계(뼈대)** | 미션당 1벌 | 여러 사용자가 공유 |
| `Mission_Setups` | **말투와 관계** | 대화 1회 | 개인, 대화별 |

```
Missions           "처음 만난 사람에게 자기소개하고 이름 물어보기"   ← 환경 무관
   └ Playbook      1) 인사 → 2) 자기소개 → 3) 이름 묻기            ← 뼈대, 상황 무관
        └ Setup    카페 / 초면 / 존댓말 / 20대 여성                 ← 연출, 이 대화에만
```

**정보는 위에서 아래로만 흐릅니다.** `Mission_Setups`는 개별 대화에만 주입되고, `Missions`나
`Mission_Playbooks`로 거슬러 올라가지 않습니다. 위 두 계층은 여러 사용자가 공유하므로,
한 사용자의 설정이 그쪽에 새면 다른 사용자에게까지 번집니다(아래 "결정 1" 참고).

## 전체 흐름

```
[1] 미션 생성
      └─ Missions.setup_guideline 생성 (기본 추천값 + 비활성 선택지 + 추천 주제/태그)
            ↓
[2] 미션 창 진입 — 가이드라인대로 초기화된 상태로 사용자가 상황 설정
      └─ Mission_Setups 1행 생성 (환경/상대역할/친밀도/예절/성별/나이대 + selectedTopic)
            ↓
[3] 대화 시작
      ├─ Mission_Setups → persona / user_task 생성 → Conversations에 저장
      └─ Mission_Playbooks 조회 (없으면 생성) ※ 상황 중립 — 아래 "결정 1" 참고
            ↓
[4] 대화 진행 — 매 턴 persona + user_task + flow 단계 + 매칭된 responseRules 주입
            ↓
[5] 피드백 — Feedbacks(conversation_id) → 성장 프로필 갱신 시 setup까지 조인해 집계
```

### 단계별 읽기/쓰기

| 단계 | 읽는 것 | 쓰는 것 |
| --- | --- | --- |
| 1 미션 생성 | `User_Profiles`, `User_Growth_Profiles`, 최근 `Mission_Records` | `Missions.setup_guideline` |
| 2 미션 창 | `Missions.setup_guideline`, 직전 `Mission_Setups`(재진입 시 복원) | `Mission_Setups` 1행 |
| 3 대화 시작 | `Mission_Setups`, `Missions`, `Mission_Playbooks` | `Conversations`(`mission_setup_id`, `persona`, `user_task`, `selected_topic`), 필요 시 `Mission_Playbooks` |
| 4 대화 진행 | `Conversations`, `Mission_Playbooks`, 최근 메시지 | `Conversation_Messages`, `Conversations.flow_step` |
| 5 피드백 | `Conversation_Messages`, `Conversations`(→`Mission_Setups`) | `Feedbacks`, `User_Growth_Profiles` |

---

## 결정 1 — 플레이북은 상황 중립으로 유지한다 (확정)

계층 원칙의 직접적인 귀결입니다. 아래는 이 원칙이 없을 때 실제로 무엇이 깨지는지에 대한 근거입니다.

### 문제

`Mission_Playbooks.mission_id`는 `@unique`이고, 플레이북은 **첫 대화 시작 시 1회 생성돼 이후 모든 사용자가 재사용**합니다 (`conversation.service.ts`의 `ensureMissionPlaybook`).

여기에 `Mission_Setups`를 생성 입력으로 넣으면, **먼저 대화를 시작한 사용자의 설정이 그 미션의 플레이북으로 굳습니다.**

- A가 `친구 / 매우 친한 사이 / 반말`로 시작 → `advanceExamples`가 반말 발화로 채워짐
- B가 같은 미션을 `선배 / 매우 낯선 사이 / 격식 존댓말`로 시작 → A의 반말 플레이북을 그대로 받음

AI 생성 미션도 `GET /missions`에서 유사 성향 사용자에게 노출되므로 공유 미션에서 실제로 발생합니다.

### 결정

**플레이북 생성 입력에 `Mission_Setups`를 넣지 않습니다.** `flow`와 `responseRules`는 미션이 결정하는 대화 뼈대이고, 상황 축은 뼈대가 아니라 **말투와 관계**입니다. 그건 이미 `Conversations.persona` / `user_task`가 담당하는 자리입니다.

```
Mission_Setups ──→ persona / user_task (대화별)  ← 상황이 반영되는 곳
               ╳→ Mission_Playbooks (미션당 1벌)  ← 상황 중립 유지
```

**말투가 달라 임베딩 매칭이 어긋나지 않는가** — `advanceExamples`는 실제 발화라 말투가 드러나지만, 단계 진행은 절대 유사도가 아니라 **단계 간 상대 비교(argmax)** 로 판정합니다(`FLOW_ADVANCE_MARGIN`). 말투 차이는 모든 단계의 유사도를 비슷하게 끌어내리므로 순위는 보존됩니다. `responseRules`는 절대 임계값(`RULE_MATCH_THRESHOLD`)을 쓰지만, 규칙 조건(`when`)은 "무슨 말을 해야 할지 모르겠다고 함" 같은 **상황 서술**이라 말투 영향이 작습니다.

### 미션이 환경 중립이면 애초에 문제가 줄어든다

계층 원칙에 따라 미션 문구가 환경·상대를 특정하지 않으므로, 플레이북의 `flow`도 "인사 → 자기소개 → 이름 묻기"처럼
**어느 상황에서나 같은 뼈대**가 됩니다. 상황을 반영해야 할 이유 자체가 크지 않습니다.
반대로 미션에 "동아리에서"가 박히면 플레이북도 그 환경에 물들고, 그때부터 상황별 분기가 불가피해집니다 —
**환경 중립 원칙을 미션 생성 단계에서 지키는 것이 이 결정의 전제**입니다.

### 만약 상황을 반영하기로 뒤집는다면 (참고용)

원칙을 지키면 필요 없지만, 실측에서 말투 불일치가 실제로 문제가 될 경우를 대비해 형태만 적어둡니다.

```prisma
model Mission_Playbooks {
  mission_id String @db.Char(36)          // @unique 제거
  // 상황 축 중 플레이북에 영향을 주는 값만 정규화해 만든 키
  // (예: "senior|4" = 상대역할|예절수준). 축 전체를 키에 넣으면 조합이 폭발한다.
  setup_signature String @default("") @db.VarChar(50)

  @@unique([mission_id, setup_signature])
}
```

`setup_signature`에 **6개 축을 전부 넣으면 안 됩니다** — 조합이 5×5×5×5×2×6 = 7,500개라 미션마다 플레이북이 무한정 늘고 캐시가 사실상 무효화됩니다. 실제로 발화 예시를 바꾸는 축은 **상대 역할과 예절 수준** 정도이므로 그 둘만 키에 넣습니다. 기존 행은 `setup_signature = ""`로 남아 그대로 재사용됩니다.

**지금은 이 컬럼을 추가하지 않습니다.** 쓰지 않을 수도 있는 컬럼을 미리 넣으면, 값이 항상 `""`인 채로 unique 키만 넓어집니다.

---

## 결정 2 — `selectedTopic`은 `Mission_Setups`로 옮긴다

### 현재

`POST /conversations`가 `selectedTopic`을 직접 받아 `Conversations.selected_topic`에 저장합니다.

```json
{ "missionId": "...", "mode": "text", "selectedTopic": "요즘 본 영화" }
```

주제는 대화 중이 아니라 **준비 단계에서 정해지고**, 같은 주제로 여러 번 대화할 수 있습니다. 그리고 이제 주제 후보는 `setup_guideline.recommendedTopics`가 제안합니다 — 제안하는 자리와 저장되는 자리가 갈라져 있습니다.

### 결정

주제의 **원본**은 `Mission_Setups.selected_topic`으로 옮깁니다.
`Conversations.selected_topic`은 **지우지 않고 복사본으로 남깁니다** — 준비 정보 쪽 주제가 나중에 바뀌어도 이미 진행된 대화의 주제는 변하면 안 되고, `mission_setup_id`가 `null`인 기존 대화도 그대로 읽혀야 합니다.

```
Mission_Setups.selected_topic  (원본, 수정 가능)
        │ 대화 시작 시 복사
        ↓
Conversations.selected_topic   (스냅샷, 이후 불변)
```

### `POST /conversations` 요청 변경

| 필드 | 변경 | 설명 |
| --- | --- | --- |
| `missionId` | 유지 | |
| `mode` | 유지 | |
| `missionSetupId` | **추가** (선택) | 앞서 만든 `Mission_Setups.id`. 주면 주제·상황이 여기서 결정됨 |
| `selectedTopic` | **deprecated** (선택) | `missionSetupId`가 없을 때만 사용. 기존 앱 호환용 |

- 둘 다 오면 **`missionSetupId`가 이깁니다** (`selectedTopic`은 무시)
- 둘 다 없으면 지금과 똑같이 동작합니다 (상황 없이 미션 정보만으로 배역 결정)
- `missionSetupId`가 다른 사용자 것이거나 `missionId`와 짝이 맞지 않으면 **404** — 남의 설정으로 대화를 시작할 수 있으면 안 됩니다

응답은 기존 형태를 유지하되 `missionSetupId`를 되돌려주면 앱이 이어지는 화면에서 재조회할 필요가 없습니다.

**설정을 어디서 만드는가** — `POST /missions/{missionId}/setups`(A 담당)로 먼저 만들고 그 id를 넘기는 2단계 방식입니다. `POST /conversations`가 설정 본문을 인라인으로 받는 1단계 방식도 가능하지만, 그러면 "설정만 하고 대화를 시작하지 않은" 상태가 기록되지 않습니다. 어느 조합에서 사용자가 이탈하는지는 가이드라인 품질을 재는 신호라 남기는 편이 낫습니다.

---

## 결정 3 — 피드백 연결에는 ERD 변경이 필요 없다

`Feedbacks.conversation_id` → `Conversations.mission_setup_id` → `Mission_Setups`로 이미 닿습니다.

```
Feedbacks → Conversations → Mission_Setups
                          → Missions
Mission_Records → Conversations → Mission_Setups
```

성장 프로필의 `struggle_situations`("카페는 괜찮은데 선배 상대만 막힌다")는 이 경로로 집계합니다. 건수가 사용자당 수십 건 수준이라 3단 조인이어도 부담이 없고, 비정규화 컬럼을 `Mission_Records`에 추가하면 `Mission_Setups`가 수정될 때 두 곳이 어긋납니다.

**피드백 채점에 상황을 반영할지**(예: `격식 존댓말` 설정인데 반말을 썼으면 감점)는 B 담당 영역입니다. 조인으로 접근 가능하므로 ERD 준비는 끝나 있습니다.

---

## 추가로 필요한 ERD 변경 — 없음

이번 흐름을 위해 새로 추가할 테이블·컬럼은 **없습니다.** 앞선 두 이슈에서 만든 것으로 충분합니다.

| 필요한 것 | 이미 있는 자리 |
| --- | --- |
| 가이드라인 저장 | `Missions.setup_guideline` |
| 사용자 설정값 저장 | `Mission_Setups` |
| 대화 ↔ 설정 연결 | `Conversations.mission_setup_id` |
| 주제 원본 / 스냅샷 | `Mission_Setups.selected_topic` / `Conversations.selected_topic` |
| 상황을 대화에 반영 | `Conversations.persona`, `user_task` |
| 피드백 ↔ 설정 연결 | `Feedbacks.conversation_id` 경유 조인 |
| 설정 재사용(직전 값 복원) | `@@index([user_id, mission_id, created_at])` |

### 선택 — 나중에 필요하면 추가할 것

둘 다 지금은 넣지 않습니다. 없어도 흐름이 완성되고, 필요해지는 시점이 와야 값의 의미가 정해지기 때문입니다.

| 후보 | 언제 필요한가 |
| --- | --- |
| `Mission_Setups.used_guideline_defaults` (Boolean) | 사용자가 기본 추천값을 그대로 썼는지 vs 바꿨는지 — 가이드라인 품질 측정용 |
| `Mission_Playbooks.setup_signature` | 결정 1을 뒤집을 때 (위에 형태 명시) |

---

## 구현 순서

앞 단계가 뒤 단계의 입력이라 순서를 지켜야 합니다.

1. **`Missions.setup_guideline` 생성** — 미션 생성 시 가이드라인 함께 생성 (유경)
2. **`POST /missions/{missionId}/setups`** — 설정 저장 API (A)
3. **`POST /conversations`에 `missionSetupId` 추가** — 설정 → `persona`/`user_task` 생성에 반영 (C)
4. **피드백·성장 프로필에서 setup 조인 집계** (유경)

2번 없이 3번을 먼저 하면 넘길 `missionSetupId`가 없고, 1번 없이 2번을 하면 미션 창을 초기화할 값이 없습니다. **1 → 2 → 3 순서로 합의가 필요합니다.**

## 협의 필요

- [ ] `POST /conversations`를 `missionSetupId` 방식으로 갈지, 설정 본문 인라인 방식으로 갈지 (위 2단계 방식 권장)
- [ ] `selectedTopic` deprecated 전환 시점 — 앱이 `missionSetupId`로 완전히 넘어오는 버전
- [ ] **기존 미션 데이터 처리** — 계층 원칙 도입 이전에 만들어진 미션 중 문구에 환경·상대가 박힌 것이 있는지 점검.
      있다면 그대로 둘지(설정과 모순될 수 있음), 문구를 다듬을지 결정 필요

계층 원칙(미션=객관적 상황 / 플레이북=뼈대 / 준비 정보=말투·관계)과 결정 1(플레이북 상황 중립)은 **확정**입니다.
