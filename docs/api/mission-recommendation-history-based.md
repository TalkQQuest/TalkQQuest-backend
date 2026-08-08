# 이력 기반 미션 추천 (성장 프로필)

> 관련 작업: 미션 생성 시 추가된 정보 활용
> 이 문서는 **추천 근거를 규칙 기반에서 실제 수행 이력(대화·피드백)으로 교체**하는 작업을 다룹니다.

## 현재 상태와 문제

### 규칙 기반 2단계는 존재하지 않는 신호를 보고 있다

`difficulty.service.ts`의 규칙은 전부 `Mission_Records.result`(`success` / `failure` / `avoidance`)를 근거로 합니다.

| 규칙 | 조건 | 결과 |
| --- | --- | --- |
| 난이도 하향 | 최근 3건 중 회피·실패 2건 이상 | 기준 난이도 −1 |
| 난이도 상향 | 최근 3건 모두 성공 | 기준 난이도 +1 |
| 카테고리 제외 | 최근 3건 중 같은 카테고리 실패 2건 이상 | 추천 후보에서 제외 |

그런데 **미션-대화에 실패라는 개념이 없습니다.** 미션을 완료하면 피드백이 생성될 뿐이고, `result`는 `POST /missions/{missionId}/complete`가 클라이언트에서 받는 값인데 실패를 보낼 흐름 자체가 없습니다. 즉 실제로는 항상 `success`가 들어옵니다.

그래서 이 규칙들은 안 쓰이는 게 아니라 **잘못 작동 중입니다.**

- 난이도 상향 조건("최근 3건 모두 성공")이 **매번 충족**돼, 3회 완료 시점부터 난이도가 `MAX_DIFFICULTY`(3, 어려움)로 올라가 굳습니다
- 하향 규칙과 카테고리 제외는 **한 번도 발동하지 않습니다** — 완화 장치 없이 상향만 남은 셈입니다
- `completeMission`의 `xpEarned = result === "success" ? reward_xp : 0` 분기도 항상 참입니다

### 정작 쌓여 있는 신호는 안 쓰인다

`Feedbacks`에는 대화마다 아래가 이미 들어 있는데 추천에 전혀 반영되지 않습니다.

- 지표 4종 점수 — `kindness_score`, `initiative_score`, `empathy_score`, `question_link_score`
- `metrics` — 지표별 `strengths` / `improvements` / `bestSentence`
- `conversation_summary`, `summary_chips`

한편 LLM 프롬프트에 들어가는 이력은 미션당 3개 필드뿐입니다.

```json
"recentMissions": [{ "title": "...", "category": "...", "result": "success" }]
```

`result`가 항상 `success`이므로 이 중 실질적인 정보는 `title`과 `category` 둘뿐입니다.

---

## 변경 방향

**신호를 `result`에서 피드백으로 교체합니다.** 그리고 추천이 원문을 직접 읽지 않도록, 피드백이 완성될 때 요약을 만들어 두고 추천은 그 한 행만 읽습니다.

```
대화 종료 → 피드백 생성(status=ready) → [성장 프로필 갱신] ─┐
                                                          ↓
GET /missions/today → 콜드스타트 판단 ─┬→ LLM 프롬프트 → 미션
                     성장 프로필 1행 ──┘
```

**추천 시점에 원문을 조인하지 않는 이유** — `GET /missions/today`는 사용자가 앱을 열면 바로 타는 경로입니다. 대화 원문과 피드백 N건을 매번 프롬프트에 넣으면 토큰·지연·비용이 대화 수에 비례해 늘고, 새로고침(하루 3회)마다 그 비용이 반복됩니다.

### 난이도는 무엇으로 정하는가

기존 규칙을 걷어내면 난이도를 정할 근거가 사라지므로, 아래로 대체합니다.

| 상황 | 기준 난이도 |
| --- | --- |
| 콜드스타트(완료 기록 없음) | 성향 시드 — 내향 1 / 그 외 2 (**기존 유지**) |
| 그 외 | 최근 완료 미션의 난이도 |

여기에 성장 프로필의 `suggested_difficulty`를 얹되, **최근 미션 난이도 기준 ±1로 클램프**한 뒤 `MIN_DIFFICULTY`~`MAX_DIFFICULTY`로 다시 클램프합니다.

클램프를 두는 이유는 요약이 LLM 파생 데이터이기 때문입니다. 한 번 어긋난 요약이 그대로 굳으면 난이도가 한 번에 튀는데, 이는 방금 걷어낸 문제(상향만 반복돼 3에 고정)를 다른 경로로 되풀이하는 것입니다. 클램프는 `result` 같은 존재하지 않는 신호에 기대지 않으므로 안전하게 남길 수 있습니다.

### 폴백

- 성장 프로필 행이 없음 / 갱신 실패 → 최근 미션 난이도 그대로, 프로필 힌트 없이 추천
- `reflected_feedback_count < 2` (표본 부족) → 같음

### 갱신 시점과 증분 커서

피드백이 `ready`가 되는 시점에 갱신합니다. 커서 뒤의 피드백만 다시 읽는 **증분 갱신**이라, 대화가 쌓여도 갱신 비용이 늘지 않습니다.

**커서는 `created_at`이 아니라 `(ready_at, id)`입니다.** 피드백은 `pending`으로 먼저 생성되고 나중에 `ready`가 되므로, 생성 순서와 `ready` 순서가 다릅니다.

> 피드백 A가 먼저 생성돼 `pending`으로 남아 있는 동안, 나중에 생성된 B가 `ready`가 되어 커서를 B의 시각까지 밀어버립니다. 그 뒤 A가 `ready`가 되어도 **A의 생성 시각이 커서보다 앞이라 영영 집계에서 빠집니다.**

그래서 `Feedbacks`에 `ready_at` 컬럼을 추가하고, `status`가 `ready`로 바뀔 때 채웁니다. 갱신 쿼리는 아래를 읽습니다.

```
WHERE user_id = ?
  AND status = 'ready'
  AND (ready_at, id) > (last_reflected_at, last_feedback_id)
ORDER BY ready_at, id
```

`id`를 타이브레이크로 두는 이유는 같은 밀리초에 여러 건이 `ready`가 될 수 있기 때문입니다. 커서는 마지막으로 읽은 행의 `(ready_at, id)`로 전진시킵니다.

이 컬럼 도입 이전 피드백은 `ready_at`이 `null`입니다. **최초 집계 시에만** `COALESCE(ready_at, created_at)`으로 한 번 따라잡고, 이후로는 `ready_at`만 씁니다.

갱신 실패는 삼킵니다 — 피드백 생성이 요약 때문에 실패하면 안 됩니다. 커서를 전진시키지 않았으므로 다음 피드백 때 같은 지점부터 다시 따라잡습니다.

---

## ERD 변경 — `User_Growth_Profiles`

사용자당 1행. 상세 주석은 `prisma/schema.prisma` 참고.

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| `user_id` | CHAR(36) UNIQUE | 사용자 |
| `summary` | TEXT | 프롬프트에 그대로 주입할 2~3문장 서술 요약 |
| `strengths` | JSON | 여러 대화에 걸쳐 반복 확인된 강점 (string[]) |
| `improvements` | JSON | 반복 지적된 개선점 (string[]) |
| `struggle_situations` | JSON | 반복해서 막힌 상황. `[{ environment, partnerRole, category, lowScoreCount }]` |
| `metric_averages` | JSON | 지표 4종 최근 평균과 추세. `{ kindness: { avg, trend }, ... }` |
| `suggested_difficulty` | TINYINT | 이력 기반 제안 난이도(1~3). 최근 미션 난이도 ±1로 클램프해서 사용 |
| `reflected_feedback_count` | INT | 반영한 피드백 건수. 2건 미만이면 신뢰하지 않음 |
| `last_feedback_id` / `last_reflected_at` | CHAR(36) / DATETIME | 증분 갱신 커서 `(ready_at, id)`. 아래 "갱신 시점과 증분 커서" 참고 |

`struggle_situations`의 집계 기준은 **`result`가 아니라 피드백 지표 점수**입니다. 특정 상황 조합에서 지표가 반복적으로 낮게 나온 횟수(`lowScoreCount`)를 세어 "막히는 상황"으로 봅니다. 카테고리가 아니라 상황 축까지 담는 이유는 "카페는 괜찮은데 선배 상대만 막힌다"를 카테고리만으로 표현할 수 없기 때문입니다.

**집계는 `Feedbacks`에서 시작합니다.**

```
Feedbacks → Conversations → Mission_Setups   (상황 축)
                          → Missions          (카테고리)
```

`Mission_Records`에서 시작하지 않는 이유는 **누락 때문**입니다. `Feedbacks.conversation_id`는 필수(그리고 unique)라 모든 피드백이 반드시 대화에 닿지만, `Mission_Records.conversation_id`는 nullable입니다. `Mission_Records`를 기점으로 잡으면 완료 기록이 없거나 `conversation_id`가 비어 있는 대화의 피드백이 통째로 빠집니다. 카테고리가 필요하면 `Conversations → Missions`를 조인해 얻습니다.

`mission_setup_id`가 `null`인 대화(이 컬럼 도입 이전 대화)는 상황 축을 알 수 없으므로 `struggle_situations` 집계에서만 제외하고, 지표 평균(`metric_averages`)에는 그대로 포함합니다.

**설계 메모 2가지**

1. `User_Profiles`에 넣지 않았습니다. 온보딩 값은 사용자가 직접 고른 것이고 이건 시스템이 자주 덮어쓰는 파생 데이터라, 섞으면 프로필을 읽는 모든 쿼리가 JSON 덩어리를 끌고 다닙니다. (`Mission_Playbooks`를 분리한 것과 같은 이유 — 그때는 미션 1건이 1.1MB까지 커져 `GET /missions`가 500으로 죽었습니다.)
2. `last_feedback_id`에 FK를 걸지 않았습니다. 참조된 피드백이 지워졌다고 커서가 `null`로 떨어지면, 이미 반영한 이력을 처음부터 다시 요약하게 됩니다. 이 값은 참조가 아니라 `(ready_at, id)` 커서의 타이브레이크 성분입니다.

---

## 걷어낼 코드

| 대상 | 처리 |
| --- | --- |
| `difficulty.service.ts` — `adjustDifficulty` | 제거 |
| `difficulty.service.ts` — `collectAvoidedCategories` | 제거 |
| `difficulty.service.ts` — `AVOIDANCE_EXCLUDE_THRESHOLD`, `RECENT_WINDOW` | 제거 |
| `difficulty.service.ts` — `seedDifficultyFromPersonality` | **유지** (콜드스타트 시드) |
| `recommendation.dto.ts` — `DifficultyAdjustment`, `DifficultyAdjustmentReason` | 제거 |
| `RecommendationCriteria.avoidedCategories` / `.difficultyAdjustment` | 제거 |
| `RecentMissionRecord.result` | 제거 (추천은 더 이상 참조하지 않음) |
| `findTemplateMissionsExcluding` | 제외 목록 인자 제거 후 이름 정리 |
| `llm.service.ts` — `buildPromptHints`의 `avoidedCategories`, `recentMissions[].result` | 제거 |

**건드리지 않는 것**

- `Mission_Records.result` 컬럼과 `MissionResult` enum, `POST /missions/{missionId}/complete`의 `result` 필드는 **그대로 둡니다.** 추천이 참조하지 않게만 바꿉니다. 완료 API는 담당이 다르고 XP 지급 분기도 이 값을 보고 있어, 함께 건드리면 이번 변경의 범위가 넘칩니다.
- 다만 실패 흐름이 앞으로도 없다면 `result` 필드 자체와 `xpEarned` 분기는 정리 대상입니다. **별도 이슈로 제안**하며, 여기서는 다루지 않습니다.
- `Recommendation_Logs.avoided_categories` / `target_difficulty` 컬럼도 유지합니다. 과거 로그 해석에 필요하고, `avoided_categories`는 앞으로 `null`만 기록됩니다.

---

## API 변경

**응답 포맷 변경은 없습니다.** 이력이 프롬프트로 들어갈 뿐이라 `GET /missions/today` / `GET /missions/{missionId}`의 필드는 그대로입니다.

다만 **`reason` 필드의 성격이 달라집니다.**

| | 예시 |
| --- | --- |
| 현재 | "모임·커뮤니티 상황을 어려워하셔서 가벼운 자기소개부터 연습해요." |
| 변경 후 | "지난 3번의 대화에서 질문은 잘 하셨지만 상대 답변을 받아 잇는 부분이 아쉬웠어요. 이번엔 되묻기에 집중해봐요." |

앱은 이미 `reason`을 표시하고 있으므로 **연동 변경은 필요 없습니다.** 다만 문장이 길어질 수 있어 UI에서 2~3줄까지 늘어나는 것을 허용해야 합니다. (현재 최대 길이 제약이 있다면 알려주세요.)

**체감상 달라지는 점 하나** — 지금은 3회 완료 후 난이도가 어려움에 고정돼 있는데, 변경 후에는 피드백 지표를 따라 오르내립니다. 기존 사용자는 다음 추천부터 난이도가 내려갈 수 있습니다.

### 제안 — `basedOn` 필드 추가 (협의 필요)

"왜 이 미션인지"를 근거 목록으로 따로 내려주면 앱에서 칩·불릿으로 보여줄 수 있습니다.

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| `basedOn` | string[] \| null | 이번 추천이 참고한 근거 0~3개. 성장 프로필을 쓰지 않은 경우(표본 부족·콜드스타트) `null` |

```json
{
  "reason": "지난 3번의 대화에서 질문은 잘 하셨지만 상대 답변을 받아 잇는 부분이 아쉬웠어요.",
  "basedOn": ["최근 대화 3회", "이어가기 점수 하락", "선배 상대 상황에서 지표 낮음"]
}
```

**필요 여부는 앱 쪽 판단입니다.** 화면에 근거를 따로 노출할 자리가 없다면 `reason` 하나로 충분하고, 그 경우 이 필드는 넣지 않습니다.

### 범위 밖 — 성장 프로필 조회 API

`GET /users/me/growth` 같은 형태로 강점·개선점·지표 추세를 사용자에게 직접 보여줄 수도 있습니다.
이번 분담에 없는 항목이라 **언급만 남기고 구현하지 않습니다.** 리포트 화면 기획이 정해지면 논의합니다.

---

## 체크리스트

- [x] `User_Growth_Profiles` 모델 및 마이그레이션
- [x] `Feedbacks.ready_at` 컬럼 및 `(user_id, ready_at)` 인덱스 추가
- [ ] `result` 기반 규칙 제거 (`adjustDifficulty`, `collectAvoidedCategories` 및 관련 DTO·프롬프트 필드)
- [ ] 난이도 결정: 최근 미션 난이도 기준 + 성장 프로필 제안값 ±1 클램프
- [ ] 요약 생성 서비스 (피드백 N건 → 요약, zod 검증, 실패 시 기존 값 유지)
- [ ] 피드백 `ready` 시 `ready_at` 기록 + `(ready_at, id)` 커서 기반 증분 갱신 훅 (실패는 삼킴)
- [ ] 추천 프롬프트에 성장 프로필 주입 (`llm.service.ts`의 `buildPromptHints`)
- [ ] 표본 부족·프로필 없음 → 프로필 없이 추천하는 폴백
- [ ] 단위 테스트: 클램프 경계, 표본 부족 폴백, 증분 커서(늦게 ready된 피드백이 누락되지 않는지), 요약 검증 실패
- [ ] 기존 테스트 정리 — `difficulty.service.test.ts`의 회피·상향 케이스 삭제
- [ ] `basedOn` 필드 추가 여부 앱 팀과 협의
- [ ] (별도 이슈 제안) `Mission_Records.result` / 완료 API `result` 필드 정리
