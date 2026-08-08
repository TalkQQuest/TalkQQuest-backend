# 미션 창 옵션 가이드라인 (setupGuideline)

> 관련 작업: ERD `Mission_Setups` 추가, 미션 생성 시 추가 정보 활용
> 이 문서는 **미션 생성이 함께 내려주는 가이드라인**을 다룹니다.
> 사용자가 고른 값을 **저장하는** API(`POST /missions/{missionId}/setups`)는 A 담당이며 별도 문서입니다.

## 배경

### 전제 — 미션은 환경·상대에 무관하게 쓴다

이 프로젝트는 미션·플레이북·준비 정보를 세 계층으로 나눕니다.

| 계층 | 담는 것 | 범위 |
| --- | --- | --- |
| `Missions` | 환경·상대에 무관한 **객관적 상황** | 전역 (여러 사용자가 공유) |
| `Mission_Playbooks` | 그 객관적 상황의 **세부 단계(뼈대)** | 미션당 1벌 (공유) |
| `Mission_Setups` | **말투와 관계** | 대화 1회 (개인) |

그래서 미션 문구에 환경이나 상대를 박지 않습니다.

| | 예시 |
| --- | --- |
| ❌ | "동아리 첫 모임에서 선배에게 자기소개하기" — 환경(동아리)과 상대(선배)가 미션에 고정됨 |
| ⭕️ | "처음 만난 사람에게 자기소개하고 이름 물어보기" — 어느 환경·상대에서도 성립 |

### 가이드라인이 필요한 이유

미션 창에서 사용자는 6개 축(환경 / 상대 역할 / 관계 친밀도 / 대화 예절 수준 / 성별 / 나이대)을 고릅니다.
미션이 환경 중립이어도 **미션의 성격상 성립하지 않는 조합**은 남습니다 — "처음 만난 사람에게 자기소개하기"에
`관계 친밀도 = 매우 친한 사이`를 고르면 미션 자체가 성립하지 않습니다.

그래서 **미션을 만들 때 옵션 가이드라인을 함께 생성해 `Missions.setup_guideline`에 굳혀 둡니다.**
앱은 미션 창 진입 시 이 값을 그대로 써서 **비활성 항목을 막고, 기본 추천값을 미리 선택된 상태로** 띄웁니다.

**요청마다 다시 뽑지 않는 이유** — 같은 미션인데 진입할 때마다 비활성 목록이 달라지면,
사용자가 지난번에 고른 값이 이번 진입에서는 선택 불가가 되는 모순이 생깁니다.

### 환경 중립 원칙이 `disabled`에 미치는 영향

미션이 환경·상대를 특정하지 않으므로, **`disabled.environment`와 `disabled.partnerRole`은 대부분 빈 배열이 됩니다.**
실제로 막히는 축은 주로 **관계 친밀도**이고, 가끔 대화 예절 수준입니다.

즉 가이드라인의 무게 중심은 "무엇을 막을까"보다 **"무엇을 기본값으로 제안할까"(`defaults`)** 에 있습니다.
`disabled`가 전부 빈 배열인 미션도 정상이며, 그 경우에도 `defaults`는 항상 채워집니다.

---

## 공통 스키마 — `SetupGuideline`

아래 두 API의 응답에 동일한 형태로 포함됩니다.

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| `defaults` | object | O | 미션 창 진입 시 **미리 선택돼 있어야 할** 축별 기본 추천값. 6개 축 모두 값이 있습니다. |
| `defaults.environment` | string | O | `school` \| `workplace` \| `daily_place` \| `community` \| `online` |
| `defaults.partnerRole` | string | O | `friend` \| `senior` \| `junior` \| `peer` \| `other` |
| `defaults.intimacyLevel` | number | O | 1(매우 낯선 사이) ~ 3(보통) ~ 5(매우 친한 사이) |
| `defaults.formalityLevel` | number | O | 1(반말) ~ 3(보통) ~ 5(매우 격식 있는 존댓말) |
| `defaults.partnerGender` | string | O | `male` \| `female` |
| `defaults.partnerAgeGroup` | string | O | `teens` \| `twenties` \| `thirties` \| `forties` \| `fifties` \| `sixties_plus` |
| `disabled` | object | O | 이 미션에서 **선택 불가**한 값들. 축별 배열이며, 막을 게 없는 축은 빈 배열입니다. |
| `disabled.environment` | string[] | O | 비활성 처리할 환경 값 목록 |
| `disabled.partnerRole` | string[] | O | 비활성 처리할 상대 역할 목록 |
| `disabled.intimacyLevel` | number[] | O | 비활성 처리할 친밀도 단계 |
| `disabled.formalityLevel` | number[] | O | 비활성 처리할 예절 수준 단계 |
| `disabled.partnerGender` | string[] | O | 비활성 처리할 성별 |
| `disabled.partnerAgeGroup` | string[] | O | 비활성 처리할 나이대 |
| `note` | string \| null | O | 왜 일부 선택지가 막혔는지 한 줄 안내. 앱에서 안내 문구로 노출해도 됩니다. |
| `recommendedTopics` | string[] | O | 추천 대화 주제(0~3개). 사용자가 고르면 `selectedTopic`으로 저장됩니다. |
| `tags` | string[] | O | 미션 성격 태그(0~5개). 예: `첫 만남`, `존댓말`, `가벼운 질문` |

### 앱 처리 규칙

1. `disabled`에 들어 있는 값은 **선택 불가로 표시**합니다.
2. `defaults`는 **항상 `disabled`와 겹치지 않도록** 서버가 보정해서 내려줍니다 — 그대로 선택 상태로 두면 됩니다.
3. 관계가 특정되지 않는 미션(초면·모르는 사람 대상)은 `defaults.partnerRole`이 `other`로 내려옵니다.
   이때도 `disabled.partnerRole`은 비어 있습니다 — 기본값만 `other`일 뿐, 사용자가 친구·선배 등으로 바꿀 수 있습니다.
4. **`setupGuideline`이 `null`일 수 있습니다.** 이 컬럼 도입 이전에 만들어진 미션과 관리자 템플릿 미션,
   그리고 가이드라인 생성이 실패한 경우입니다. 이때는 **6개 축을 모두 활성 상태로, 앱 기본값으로** 띄워주세요.
   (미션 생성이 가이드라인 때문에 실패하면 안 되므로, 실패 시 `null`로 두고 미션은 정상 생성합니다.)

### 예시

```json
{
  "defaults": {
    "environment": "community",
    "partnerRole": "other",
    "intimacyLevel": 2,
    "formalityLevel": 4,
    "partnerGender": "female",
    "partnerAgeGroup": "twenties"
  },
  "disabled": {
    "environment": [],
    "partnerRole": [],
    "intimacyLevel": [4, 5],
    "formalityLevel": [1],
    "partnerGender": [],
    "partnerAgeGroup": []
  },
  "note": "처음 만나는 상황이라 친한 사이·반말 설정은 선택할 수 없어요.",
  "recommendedTopics": ["여기 자주 오는지 물어보기", "서로 어떻게 알게 됐는지"],
  "tags": ["첫 만남", "자기소개", "이름 묻기"]
}
```

---

# GET /missions/today

오늘의 추천 미션 조회. **응답에 `setupGuideline`이 추가**됩니다. 나머지 필드는 기존과 동일합니다.

## Header

| 키 | 값 | 필수 | 설명 |
| --- | --- | --- | --- |
| Authorization | Bearer {accessToken} | O | 액세스 토큰 |

## Request

**Path Variable**

```
없음
```

**Query String**

```
date=2026-08-08     // 선택. 클라이언트 기준 오늘(YYYY-MM-DD). 생략 시 서버 기준 오늘
refresh=true        // 선택. 오늘 추천이 있어도 새로 뽑기 (하루 3회 제한)
```

## Body

```
없음
```

## Response

**200 ok**

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| missionId | string | 추천 미션 id. 항상 값이 있습니다 |
| title | string | 미션 제목 |
| category | string | 카테고리 |
| difficulty | string | `쉬움` \| `보통` \| `어려움` |
| estimatedMinutes | number | 예상 소요 시간(분) |
| rewardXp | number | 보상 XP |
| description | string | 미션 설명 |
| reason | string | 추천 이유 |
| expectedEffect | string | 기대 효과 |
| source | string | `template` \| `fallback` \| `llm` |
| isSaved | boolean | 저장 여부 |
| recommendationLogId | string | 추천 로그 id |
| date | string | 이 추천이 속한 날짜(YYYY-MM-DD) |
| refreshCount | number | 오늘 사용한 새로고침 횟수 |
| refreshLimit | number | 하루 새로고침 상한(현재 3) |
| remainingRefreshes | number | 남은 새로고침 횟수 |
| isNew | boolean | 이번 호출에서 새로 뽑은 추천인지 |
| **setupGuideline** | **object \| null** | **[추가] 미션 창 옵션 가이드라인. 구조는 위 `SetupGuideline` 참고** |

```json
{
  "success": true,
  "data": {
    "missionId": "3f8a1c2e-0b44-4a91-9f2d-77e0c9a51b30",
    "title": "처음 만난 사람에게 자기소개하고 이름 물어보기",
    "category": "짧은 대화",
    "difficulty": "보통",
    "estimatedMinutes": 10,
    "rewardXp": 20,
    "description": "상대에게 먼저 자기소개를 하고, 자연스럽게 이름을 물어보세요.",
    "reason": "처음 보는 사람에게 말 거는 것을 어려워하셔서 가벼운 자기소개부터 연습해요.",
    "expectedEffect": "처음 만난 사람 앞에서 말문을 여는 부담이 줄어듭니다.",
    "source": "llm",
    "isSaved": false,
    "recommendationLogId": "9c1b7d40-2e35-4c88-a0f1-5b6ea2d94c17",
    "date": "2026-08-08",
    "refreshCount": 0,
    "refreshLimit": 3,
    "remainingRefreshes": 3,
    "isNew": true,
    "setupGuideline": {
      "defaults": {
        "environment": "community",
        "partnerRole": "other",
        "intimacyLevel": 2,
        "formalityLevel": 4,
        "partnerGender": "female",
        "partnerAgeGroup": "twenties"
      },
      "disabled": {
        "environment": [],
        "partnerRole": [],
        "intimacyLevel": [4, 5],
        "formalityLevel": [1],
        "partnerGender": [],
        "partnerAgeGroup": []
      },
      "note": "처음 만나는 상황이라 친한 사이·반말 설정은 선택할 수 없어요.",
      "recommendedTopics": ["여기 자주 오는지 물어보기", "서로 어떻게 알게 됐는지"],
      "tags": ["첫 만남", "자기소개", "이름 묻기"]
    }
  }
}
```

### Error

| 상태코드 | 에러코드 | 메시지 | 원인 |
| --- | --- | --- | --- |
| 400 | INVALID_MISSION_DATE | 오늘 날짜가 올바르지 않습니다. | `date`가 서버 기준 오늘과 하루 넘게 차이남 |
| 401 | UNAUTHORIZED | 인증이 필요합니다. | 토큰 없음/만료 |
| 404 | MISSION_PROFILE_NOT_FOUND | 온보딩이 완료되지 않아 미션을 추천할 수 없습니다. | 온보딩 미완료 |
| 429 | MISSION_REFRESH_LIMIT_EXCEEDED | 오늘 미션을 새로 받을 수 있는 횟수를 모두 사용했습니다. | 하루 3회 초과 |

### Exception

| 상태코드 | 에러코드 | 메시지 | 원인 |
| --- | --- | --- | --- |
| 500 | INTERNAL_SERVER_ERROR | 서버 오류가 발생했습니다. | 예기치 못한 서버 오류 |

---

# GET /missions/{missionId}

미션 상세 조회. **응답에 `setupGuideline`이 추가**됩니다.
저장해 둔 미션이나 목록에서 들어온 미션도 미션 창을 띄워야 하므로, 상세에도 같은 값을 내려줍니다.

## Header

| 키 | 값 | 필수 | 설명 |
| --- | --- | --- | --- |
| Authorization | Bearer {accessToken} | O | 액세스 토큰 |

## Request

**Path Variable**

```
missionId: string (UUID)   // 조회할 미션 id
```

**Query String**

```
없음
```

## Body

```
없음
```

## Response

**200 ok**

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| id | string | 미션 id |
| title | string | 미션 제목 |
| category | string | 카테고리 |
| difficulty | string | `쉬움` \| `보통` \| `어려움` |
| estimatedMinutes | number | 예상 소요 시간(분) |
| rewardXp | number | 보상 XP |
| description | string | 미션 설명 |
| preparationTip | string \| null | 준비 팁 |
| caution | string \| null | 주의 사항 |
| isSaved | boolean | 저장 여부 |
| **setupGuideline** | **object \| null** | **[추가] 미션 창 옵션 가이드라인. 구조는 위 `SetupGuideline` 참고** |

```json
{
  "success": true,
  "data": {
    "id": "3f8a1c2e-0b44-4a91-9f2d-77e0c9a51b30",
    "title": "처음 만난 사람에게 자기소개하고 이름 물어보기",
    "category": "짧은 대화",
    "difficulty": "보통",
    "estimatedMinutes": 10,
    "rewardXp": 20,
    "description": "상대에게 먼저 자기소개를 하고, 자연스럽게 이름을 물어보세요.",
    "preparationTip": "이름과 간단한 소개 한 줄 정도만 준비해도 충분해요.",
    "caution": "말이 막혀도 괜찮아요. 짧게 끊어 말해도 됩니다.",
    "isSaved": false,
    "setupGuideline": {
      "defaults": {
        "environment": "community",
        "partnerRole": "other",
        "intimacyLevel": 2,
        "formalityLevel": 4,
        "partnerGender": "female",
        "partnerAgeGroup": "twenties"
      },
      "disabled": {
        "environment": [],
        "partnerRole": [],
        "intimacyLevel": [4, 5],
        "formalityLevel": [1],
        "partnerGender": [],
        "partnerAgeGroup": []
      },
      "note": "처음 만나는 상황이라 친한 사이·반말 설정은 선택할 수 없어요.",
      "recommendedTopics": ["여기 자주 오는지 물어보기", "서로 어떻게 알게 됐는지"],
      "tags": ["첫 만남", "자기소개", "이름 묻기"]
    }
  }
}
```

### Error

| 상태코드 | 에러코드 | 메시지 | 원인 |
| --- | --- | --- | --- |
| 401 | UNAUTHORIZED | 인증이 필요합니다. | 토큰 없음/만료 |
| 404 | MISSION_NOT_FOUND | 존재하지 않는 미션입니다. | 없는 미션이거나 열람 권한이 없는 미션 |

### Exception

| 상태코드 | 에러코드 | 메시지 | 원인 |
| --- | --- | --- | --- |
| 500 | INTERNAL_SERVER_ERROR | 서버 오류가 발생했습니다. | 예기치 못한 서버 오류 |

---

## 서버 구현 메모 (앱 참고용 아님)

- 가이드라인은 **미션이 처음 만들어질 때 1회** 생성해 `Missions.setup_guideline`에 저장합니다.
  (`GET /missions/today`의 추천 → 미션 생성 트랜잭션 안에서 같이 처리)
- 미션 생성 프롬프트에는 기존 온보딩 정보에 더해 **성장 프로필**(`User_Growth_Profiles`)을 넣어,
  최근 막혔던 상황이 기본값과 태그 추천에 반영되게 합니다. (`mission-recommendation-history-based.md` 참고)
- **미션 문구 자체는 환경·상대 중립으로 생성해야 합니다.** 프롬프트에 "장소·소속·상대의 역할을 미션 문구에
  넣지 말 것"을 명시하고, 생성 결과에 그런 표현이 섞이면 재생성하거나 템플릿으로 폴백합니다.
  이걸 놓치면 미션에 "동아리에서"가 박히고, 사용자가 환경을 `직장`으로 골랐을 때 미션과 설정이 서로 모순됩니다.
- LLM 응답은 zod로 검증하고, 축별 허용값 집합(enum)과 대조해 **모르는 값은 버립니다.**
  `defaults`가 `disabled`와 겹치면 서버가 겹치지 않는 값으로 보정합니다.
- 검증에 실패하면 `setup_guideline`은 `null`로 두고 미션은 정상 생성합니다.
- `disabled`가 전부 빈 배열인 것은 **정상이며 실패가 아닙니다.** 환경 중립 미션에서는 오히려 그쪽이 기본입니다.
