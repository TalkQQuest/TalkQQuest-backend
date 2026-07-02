# Design Document

## Overview

TalkQuest 백엔드는 Node.js + Express.js 기반 REST API 서버로 구현됩니다.
인증, 미션, AI 코칭, 커뮤니티, 결제 등 도메인별 모듈로 분리하며,
MySQL을 주 데이터베이스로, Redis를 세션/캐시 저장소로 사용합니다.

## Architecture

### 기술 스택

| 구분 | 기술 |
|------|------|
| Runtime | Node.js 20 LTS |
| Framework | Express.js |
| Language | TypeScript |
| Database | MySQL 8.0 |
| ORM | Prisma |
| Cache/Session | Redis |
| Authentication | JWT (Access + Refresh Token) |
| Routing & API Documentation | tsoa (데코레이터 기반 라우팅, Swagger/OpenAPI 3.0 자동 생성) |
| Validation | Zod |
| Logging | Pino (+ pino-http, 개발 환경은 pino-pretty) |
| Testing | Jest + Supertest |
| Real-time | Socket.IO (채팅) |
| Push Notification | Firebase Cloud Messaging (FCM, Android) |
| Payment | PG사 SDK (예: 토스페이먼츠/아임포트) Webhook 연동 |

### 디렉토리 구조

```
src/
├── app.ts                  # Express 앱 초기화
├── server.ts               # 서버 진입점
├── config/                 # 환경 설정
│   ├── database.ts
│   ├── redis.ts
│   └── env.ts
├── middlewares/            # 공통 미들웨어
│   ├── auth.ts
│   ├── errorHandler.ts
│   ├── requestId.ts
│   └── validator.ts
├── modules/               # 도메인별 모듈 (controller → service → repository)
│   ├── auth/
│   │   ├── controllers/
│   │   │   └── auth.controller.ts   # tsoa @Route 데코레이터로 라우트 정의
│   │   ├── services/
│   │   │   └── auth.service.ts
│   │   ├── repositories/
│   │   │   └── auth.repository.ts   # Prisma 접근은 이 계층에서만 수행
│   │   └── dtos/
│   │       └── auth.dto.ts
│   ├── onboarding/
│   ├── mission/
│   ├── coaching/
│   ├── community/
│   ├── payment/
│   ├── report/
│   └── notification/        # FCM 푸시 발송
├── shared/                # 공통 유틸리티
│   ├── types/
│   ├── utils/
│   └── constants/
├── generated/             # tsoa가 생성하는 routes.ts (자동 생성, 수정 금지)
│   └── routes.ts
└── prisma/
    ├── schema.prisma
    └── migrations/
```

> 라우팅은 `*.routes.ts`를 수동 작성하지 않고, 컨트롤러에 `@Route`/`@Get`/`@Post` 등 tsoa 데코레이터를 붙여 빌드 시 `tsoa spec-and-routes`가 `generated/routes.ts`와 `swagger.json`을 자동 생성한다.

### Database

`schema.prisma`의 datasource는 MySQL을 사용한다.

```prisma
datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL") // mysql://user:password@host:3306/talkquest
}
```

PK는 `CHAR(36)`에 애플리케이션(Prisma `uuid()`) 또는 MySQL `UUID()` 함수로 생성한 UUID 문자열을 저장한다.
PostgreSQL의 `JSONB` 컬럼은 MySQL 8.0의 네이티브 `JSON` 타입으로 대체한다.

## ERD (Entity Relationship Diagram)

### Users

| Column | Type | Constraints |
|--------|------|-------------|
| id | CHAR(36) | PK |
| email | VARCHAR(255) | UNIQUE, NOT NULL |
| nickname | VARCHAR(50) | NULL |
| provider | ENUM('kakao','naver') | NOT NULL |
| provider_id | VARCHAR(255) | NOT NULL |
| terms_agreed_at | TIMESTAMP | NULL |
| created_at | TIMESTAMP | NOT NULL, DEFAULT NOW() |
| last_login_at | TIMESTAMP | NULL |
| status | ENUM('active','inactive','deleted') | DEFAULT 'active' |
| deleted_at | TIMESTAMP | NULL |

### User_Profiles

| Column | Type | Constraints |
|--------|------|-------------|
| id | CHAR(36) | PK |
| user_id | CHAR(36) | FK → Users.id, UNIQUE |
| personality_type | ENUM('introvert','extrovert','ambivert') | NULL |
| conversation_burden | INT (1-5) | NULL |
| difficult_situations | JSON | NULL |
| purpose | VARCHAR(255) | NULL |
| goals | JSON | NULL |
| preferred_style | VARCHAR(255) | NULL |
| interests | JSON | NULL |
| level | INT | DEFAULT 1 |
| experience | INT | DEFAULT 0 |
| onboarding_completed | BOOLEAN | DEFAULT FALSE |
| onboarding_step | INT | DEFAULT 0 |
| onboarding_temp_data | JSON | NULL |
| created_at | TIMESTAMP | NOT NULL |
| updated_at | TIMESTAMP | NOT NULL |

### Login_History

| Column | Type | Constraints |
|--------|------|-------------|
| id | CHAR(36) | PK |
| user_id | CHAR(36) | FK → Users.id |
| device_info | JSON | NULL |
| ip_address | VARCHAR(45) | NULL |
| logged_in_at | TIMESTAMP | NOT NULL |

### Refresh_Tokens

| Column | Type | Constraints |
|--------|------|-------------|
| id | CHAR(36) | PK |
| user_id | CHAR(36) | FK → Users.id |
| token | VARCHAR(512) | NOT NULL, UNIQUE |
| device_info | JSON | NULL |
| expires_at | TIMESTAMP | NOT NULL |
| revoked | BOOLEAN | DEFAULT FALSE |
| created_at | TIMESTAMP | NOT NULL |

### Missions

| Column | Type | Constraints |
|--------|------|-------------|
| id | CHAR(36) | PK |
| title | VARCHAR(255) | NOT NULL |
| description | TEXT | NOT NULL |
| preparation_tip | TEXT | NULL |
| caution | TEXT | NULL |
| difficulty | INT (1-5) | NOT NULL |
| estimated_time | INT (minutes) | NOT NULL |
| category | VARCHAR(100) | NOT NULL |
| is_template | BOOLEAN | DEFAULT FALSE |
| created_at | TIMESTAMP | NOT NULL |

### Mission_Records

| Column | Type | Constraints |
|--------|------|-------------|
| id | CHAR(36) | PK |
| user_id | CHAR(36) | FK → Users.id |
| mission_id | CHAR(36) | FK → Missions.id |
| result | ENUM('success','failure','avoidance') | NOT NULL |
| memo | TEXT | NULL |
| duration_minutes | INT | NULL |
| emotion | VARCHAR(50) | NULL |
| tokens_earned | INT | DEFAULT 0 |
| experience_earned | INT | DEFAULT 0 |
| temp_data | JSON | NULL |
| status | ENUM('in_progress','completed') | DEFAULT 'in_progress' |
| created_at | TIMESTAMP | NOT NULL |
| completed_at | TIMESTAMP | NULL |

### Mission_Recommendations

| Column | Type | Constraints |
|--------|------|-------------|
| id | CHAR(36) | PK |
| user_id | CHAR(36) | FK → Users.id |
| mission_id | CHAR(36) | FK → Missions.id |
| reason | TEXT | NOT NULL |
| expected_effect | TEXT | NULL |
| difficulty_for_user | INT (1-5) | NOT NULL |
| is_active | BOOLEAN | DEFAULT TRUE |
| created_at | TIMESTAMP | NOT NULL |

### Badges

| Column | Type | Constraints |
|--------|------|-------------|
| id | CHAR(36) | PK |
| name | VARCHAR(100) | NOT NULL |
| description | TEXT | NULL |
| condition | JSON | NOT NULL |
| icon_url | VARCHAR(500) | NULL |

### User_Badges

| Column | Type | Constraints |
|--------|------|-------------|
| id | CHAR(36) | PK |
| user_id | CHAR(36) | FK → Users.id |
| badge_id | CHAR(36) | FK → Badges.id |
| earned_at | TIMESTAMP | NOT NULL |

### Coaching_Sessions

| Column | Type | Constraints |
|--------|------|-------------|
| id | CHAR(36) | PK |
| user_id | CHAR(36) | FK → Users.id |
| context | JSON | NULL |
| tone_setting | VARCHAR(50) | NULL |
| difficulty_setting | INT (1-5) | NULL |
| tokens_used | INT | DEFAULT 0 |
| created_at | TIMESTAMP | NOT NULL |
| updated_at | TIMESTAMP | NOT NULL |

### Coaching_Messages

| Column | Type | Constraints |
|--------|------|-------------|
| id | CHAR(36) | PK |
| session_id | CHAR(36) | FK → Coaching_Sessions.id |
| role | ENUM('user','assistant') | NOT NULL |
| content | TEXT | NOT NULL |
| created_at | TIMESTAMP | NOT NULL |

### Communities

| Column | Type | Constraints |
|--------|------|-------------|
| id | CHAR(36) | PK |
| name | VARCHAR(200) | NOT NULL |
| description | TEXT | NULL |
| capacity | INT | NOT NULL |
| current_members | INT | DEFAULT 0 |
| join_condition | JSON | NULL |
| activity_frequency | VARCHAR(50) | NULL |
| interests | JSON | NULL |
| created_at | TIMESTAMP | NOT NULL |

### Community_Members

| Column | Type | Constraints |
|--------|------|-------------|
| id | CHAR(36) | PK |
| community_id | CHAR(36) | FK → Communities.id |
| user_id | CHAR(36) | FK → Users.id |
| status | ENUM('active','waiting') | NOT NULL |
| joined_at | TIMESTAMP | NULL |
| waitlisted_at | TIMESTAMP | NULL |

### Chat_Messages

| Column | Type | Constraints |
|--------|------|-------------|
| id | CHAR(36) | PK |
| community_id | CHAR(36) | FK → Communities.id |
| user_id | CHAR(36) | FK → Users.id |
| content | TEXT | NOT NULL |
| created_at | TIMESTAMP | NOT NULL |

### Token_Accounts

| Column | Type | Constraints |
|--------|------|-------------|
| id | CHAR(36) | PK |
| user_id | CHAR(36) | FK → Users.id, UNIQUE |
| balance | INT | DEFAULT 0 |
| total_earned | INT | DEFAULT 0 |
| total_used | INT | DEFAULT 0 |
| updated_at | TIMESTAMP | NOT NULL |

### Token_Transactions

| Column | Type | Constraints |
|--------|------|-------------|
| id | CHAR(36) | PK |
| user_id | CHAR(36) | FK → Users.id |
| amount | INT | NOT NULL |
| type | ENUM('earn','spend','purchase') | NOT NULL |
| reason | VARCHAR(255) | NOT NULL |
| reference_id | CHAR(36) | NULL |
| created_at | TIMESTAMP | NOT NULL |

### Subscriptions

| Column | Type | Constraints |
|--------|------|-------------|
| id | CHAR(36) | PK |
| user_id | CHAR(36) | FK → Users.id |
| plan | ENUM('free','basic','premium') | NOT NULL |
| started_at | TIMESTAMP | NOT NULL |
| expires_at | TIMESTAMP | NULL |
| is_active | BOOLEAN | DEFAULT TRUE |
| created_at | TIMESTAMP | NOT NULL |

### Payments

| Column | Type | Constraints |
|--------|------|-------------|
| id | CHAR(36) | PK |
| user_id | CHAR(36) | FK → Users.id |
| subscription_id | CHAR(36) | FK → Subscriptions.id, NULL |
| amount | DECIMAL(10,2) | NOT NULL |
| currency | VARCHAR(3) | DEFAULT 'KRW' |
| method | VARCHAR(50) | NOT NULL |
| status | ENUM('pending','completed','failed','refunded') | NOT NULL |
| external_id | VARCHAR(255) | NULL |
| retry_count | INT | DEFAULT 0 |
| created_at | TIMESTAMP | NOT NULL |
| completed_at | TIMESTAMP | NULL |

### Device_Tokens

| Column | Type | Constraints |
|--------|------|-------------|
| id | CHAR(36) | PK |
| user_id | CHAR(36) | FK → Users.id |
| fcm_token | VARCHAR(500) | NOT NULL |
| platform | ENUM('android') | NOT NULL, DEFAULT 'android' |
| last_active_at | TIMESTAMP | NOT NULL |
| created_at | TIMESTAMP | NOT NULL |

### Notification_Settings

| Column | Type | Constraints |
|--------|------|-------------|
| id | CHAR(36) | PK |
| user_id | CHAR(36) | FK → Users.id, UNIQUE |
| mission_reminder | BOOLEAN | DEFAULT TRUE |
| community_chat | BOOLEAN | DEFAULT TRUE |
| token_warning | BOOLEAN | DEFAULT TRUE |
| marketing | BOOLEAN | DEFAULT FALSE |
| updated_at | TIMESTAMP | NOT NULL |

## API Specification

### Base URL

```
/api/v1
```

### Common Response Format

```json
{
  "success": true,
  "data": { ... },
  "error": null
}
```

### Common Error Format

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "E4001",
    "message": "입력값이 올바르지 않습니다",
    "details": [{ "field": "email", "message": "유효한 이메일 형식이 아닙니다" }]
  }
}
```

### Auth APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /auth/kakao | 카카오 OAuth 로그인 |
| POST | /auth/naver | 네이버 OAuth 로그인 |
| POST | /auth/refresh | Access Token 재발급 |
| POST | /auth/logout | 로그아웃 |
| DELETE | /auth/account | 계정 삭제 요청 |

> **Android 클라이언트 인증 방식**: 프론트엔드가 Android 네이티브 앱으로 고정되므로, Kakao SDK / Naver SDK는 디바이스에서 OAuth 인가 코드(authorization code)를 직접 토큰으로 교환한 뒤 **Provider Access Token**을 발급한다. 따라서 백엔드는 Authorization Code → Token 교환을 수행하지 않고, **클라이언트가 전달한 Provider Access Token을 그대로 카카오/네이버의 사용자 정보 조회 API에 전달해 검증**하는 방식으로 구현한다. (웹 OAuth Redirect 플로우 전제로 한 `code` 파라미터는 사용하지 않음)

#### POST /auth/kakao

**Request Body:**
```json
{
  "providerAccessToken": "string (Kakao SDK에서 발급한 access token)",
  "deviceInfo": {
    "platform": "android",
    "model": "string",
    "osVersion": "string",
    "fcmToken": "string (FCM 푸시 토큰, 선택)"
  }
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "accessToken": "string",
    "refreshToken": "string",
    "expiresIn": 3600,
    "isNewUser": true,
    "needsLinking": false,
    "user": {
      "id": "uuid",
      "email": "string",
      "nickname": "string",
      "provider": "kakao"
    }
  }
}
```

#### POST /auth/naver

**Request Body:**
```json
{
  "providerAccessToken": "string (Naver SDK에서 발급한 access token)",
  "deviceInfo": {
    "platform": "android",
    "model": "string",
    "osVersion": "string",
    "fcmToken": "string (FCM 푸시 토큰, 선택)"
  }
}
```

**Response (200):** `/auth/kakao`와 동일한 구조, `provider: "naver"`

#### POST /auth/refresh

**Request Body:**
```json
{
  "refreshToken": "string"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "accessToken": "string",
    "expiresIn": 3600
  }
}
```

### Onboarding APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /onboarding/status | 온보딩 진행 상태 조회 |
| POST | /onboarding/steps/:step | 단계별 응답 저장 |
| POST | /onboarding/complete | 온보딩 완료 처리 |

#### GET /onboarding/status

**Response (200):**
```json
{
  "success": true,
  "data": {
    "completed": false,
    "currentStep": 3,
    "totalSteps": 5,
    "savedData": {
      "1": { "personalityType": "introvert" },
      "2": { "conversationBurden": 4 }
    }
  }
}
```

#### POST /onboarding/steps/:step

**Request Body (step 1 예시):**
```json
{
  "personalityType": "introvert"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "step": 1,
    "saved": true,
    "nextStep": 2
  }
}
```

#### POST /onboarding/complete

**Response (200):**
```json
{
  "success": true,
  "data": {
    "profileCreated": true,
    "recommendationReady": true
  }
}
```

### Mission APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /missions/recommendations | 미션 추천 목록 조회 |
| GET | /missions/:id | 미션 상세 조회 |
| POST | /missions/:id/start | 미션 시작 |
| PUT | /missions/:id/progress | 미션 진행 임시 저장 |
| POST | /missions/:id/complete | 미션 결과 제출 |
| GET | /missions/records | 미션 수행 기록 목록 |

#### GET /missions/recommendations

**Response (200):**
```json
{
  "success": true,
  "data": {
    "missions": [
      {
        "id": "uuid",
        "title": "카페에서 바리스타에게 메뉴 추천 물어보기",
        "description": "...",
        "difficulty": 2,
        "estimatedTime": 10,
        "reason": "낮은 부담의 서비스 대화부터 시작하면 좋겠어요",
        "expectedEffect": "간단한 질문으로 대화 자신감 향상",
        "category": "service_conversation"
      }
    ]
  }
}
```

#### POST /missions/:id/complete

**Request Body:**
```json
{
  "result": "success",
  "memo": "생각보다 쉬웠다",
  "durationMinutes": 5,
  "emotion": "satisfied"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "record": {
      "id": "uuid",
      "result": "success",
      "tokensEarned": 10,
      "experienceEarned": 50,
      "badgesEarned": [],
      "streakCount": 3
    },
    "nextRecommendations": [...]
  }
}
```

### Coaching APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /coaching/sessions | 코칭 세션 생성 |
| POST | /coaching/sessions/:id/messages | 코칭 메시지 전송 |
| GET | /coaching/sessions/:id | 코칭 세션 상세 (대화 이력) |
| GET | /coaching/sessions | 코칭 세션 목록 |

#### POST /coaching/sessions

**Request Body:**
```json
{
  "context": { "situation": "string", "relation": "string" },
  "toneSetting": "casual | polite",
  "difficultySetting": 2
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "sessionId": "uuid",
    "tokensRemaining": 120
  }
}
```

#### POST /coaching/sessions/:id/messages

**Request Body:**
```json
{
  "content": "string (사용자 입력 메시지)"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "message": {
      "role": "assistant",
      "content": "string",
      "expressionExamples": ["string"],
      "responseAlternatives": ["string"],
      "followUpQuestions": ["string"]
    },
    "tokensUsed": 5,
    "tokensRemaining": 115
  }
}
```

**Error (402 — 토큰 부족):**
```json
{
  "success": false,
  "data": null,
  "error": { "code": "T4021", "message": "토큰이 부족합니다" }
}
```

### Community APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /communities/recommendations | 사용자 성향 기반 모임 추천 목록 |
| GET | /communities/:id | 모임 상세 조회 |
| POST | /communities/:id/join | 모임 참여 요청 |
| DELETE | /communities/:id/leave | 모임 탈퇴 |
| GET | /communities/:id/messages | 채팅 메시지 목록 (페이지네이션) |
| POST | /communities/:id/messages | 채팅 메시지 전송 |

#### GET /communities/recommendations

**Response (200):**
```json
{
  "success": true,
  "data": {
    "communities": [
      {
        "id": "uuid",
        "name": "주말 등산 모임",
        "description": "...",
        "capacity": 20,
        "currentMembers": 18,
        "joinCondition": { "minLevel": 1 },
        "activityFrequency": "weekly",
        "interests": ["outdoor"]
      }
    ]
  }
}
```

#### POST /communities/:id/join

**Response (200 — 정상 참여):**
```json
{
  "success": true,
  "data": { "status": "active", "joinedAt": "ISODate" }
}
```

**Response (200 — 정원 초과, 대기 등록):**
```json
{
  "success": true,
  "data": {
    "status": "waiting",
    "waitlistedAt": "ISODate",
    "alternativeCommunities": [{ "id": "uuid", "name": "string" }]
  }
}
```

#### POST /communities/:id/messages

채팅 메시지는 REST 저장과 동시에 Socket.IO 채널(`community:{id}`)로 실시간 브로드캐스트한다.

**Request Body:**
```json
{ "content": "string" }
```

**Response (201):**
```json
{
  "success": true,
  "data": { "id": "uuid", "content": "string", "createdAt": "ISODate" }
}
```

### Token & Payment APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /tokens/balance | 토큰 잔여량 및 누적 사용량 조회 |
| GET | /tokens/transactions | 토큰 사용/적립 내역 (페이지네이션) |
| GET | /payments/plans | 요금제 목록 조회 |
| POST | /payments | 결제 요청 (요금제 구독 또는 토큰 충전) |
| GET | /payments/:id | 결제 상세/상태 조회 |
| POST | /payments/webhook | PG사 결제 결과 Webhook 수신 |

#### GET /tokens/balance

**Response (200):**
```json
{
  "success": true,
  "data": {
    "balance": 35,
    "totalEarned": 200,
    "totalUsed": 165,
    "lowBalanceWarning": true
  }
}
```

#### POST /payments

**Request Body:**
```json
{
  "type": "subscription | token_charge",
  "plan": "basic | premium",
  "method": "card | kakaopay | naverpay",
  "amount": 9900
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "paymentId": "uuid",
    "status": "pending",
    "redirectUrl": "string (PG사 결제창 URL, Android WebView/인앱 호출용)"
  }
}
```

**Error (결제 실패, 1회 재시도 후):**
```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "P4022",
    "message": "결제에 실패했습니다",
    "details": [{ "field": "method", "message": "다른 결제 수단을 시도해주세요" }]
  }
}
```

#### POST /payments/webhook

PG사 서버가 호출하는 엔드포인트로, 서명 검증 후 `Payments.status`를 갱신하고 구독/토큰을 활성화한다. 일반 사용자 인증(JWT)이 아닌 PG사 서명 검증 미들웨어를 사용한다.

### Report APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /reports/summary | 누적 성장 리포트 조회 |
| GET | /reports/weekly | 주간 리포트 조회 |

#### GET /reports/summary

**Response (200):**
```json
{
  "success": true,
  "data": {
    "totalMissions": 42,
    "successRate": 0.76,
    "difficultyTrend": [{ "week": "2026-W20", "avgDifficulty": 2.1 }],
    "frequentSituations": [{ "category": "service_conversation", "count": 15 }]
  }
}
```

#### GET /reports/weekly

**Response (200):**
```json
{
  "success": true,
  "data": {
    "week": "2026-W26",
    "missionsCompleted": 5,
    "successRate": 0.8,
    "summary": "string"
  }
}
```

### Profile & Settings APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /users/me | 내 프로필 조회 (성향, 레벨, 배지, 경험치) |
| GET | /users/me/records | 미션 수행 기록 목록 (페이지네이션) |
| PUT | /users/me/notifications | 알림 설정 변경 |
| PUT | /users/me/device-token | FCM 토큰 등록/갱신 |

#### GET /users/me

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "nickname": "string",
    "level": 3,
    "experience": 420,
    "badges": [{ "id": "uuid", "name": "string", "earnedAt": "ISODate" }],
    "personalityType": "introvert"
  }
}
```

#### PUT /users/me/notifications

**Request Body:**
```json
{
  "missionReminder": true,
  "communityChat": true,
  "tokenWarning": true,
  "marketing": false
}
```

#### PUT /users/me/device-token

Android 앱이 FCM 토큰을 최초 발급/갱신할 때마다 호출한다.

**Request Body:**
```json
{ "fcmToken": "string" }
```

## Push Notification 발송 정책 (Android / FCM)

- `Notification_Settings`의 항목별 동의 여부를 확인한 뒤에만 발송한다.
- 발송 대상 토큰은 `Device_Tokens`에서 `user_id` 기준 최신 토큰을 조회한다.
- FCM 응답이 `UNREGISTERED` / `INVALID_ARGUMENT`이면 해당 토큰을 `Device_Tokens`에서 즉시 삭제한다.
- 발송 유형: 미션 리마인드(`mission_reminder`), 커뮤니티 채팅 알림(`community_chat`), 토큰 부족 경고(`token_warning`), 마케팅(`marketing`).

## Error Codes

도메인 접두사 + 일련번호 형식으로 코드를 부여한다 (예: `A`=Auth, `O`=Onboarding, `M`=Mission, `C`=Coaching, `CM`=Community, `T`=Token, `P`=Payment, `R`=Report, `E`=공통/Common).
같은 도메인 안에서도 에러 종류별로 별도 클래스(`*.error.ts`)를 만들고, 공통 `AppError`를 상속해 `errorCode`/`statusCode`/`message`/`data`를 갖도록 한다.

| Code | Name | HTTP Status | Description |
|------|------|-------------|-------------|
| E4001 | VALIDATION_ERROR | 400 | 요청 데이터 유효성 검증 실패 |
| A4011 | UNAUTHORIZED | 401 | Access Token 누락/만료/무효 |
| A4031 | FORBIDDEN | 403 | 권한 없음 |
| E4041 | NOT_FOUND | 404 | 리소스를 찾을 수 없음 |
| T4021 | INSUFFICIENT_TOKENS | 402 | 토큰 잔여량 부족 |
| CM4091 | COMMUNITY_FULL | 409 | 모임 정원 초과 (대기 등록으로 처리) |
| P4022 | PAYMENT_FAILED | 402 | 결제 처리 실패 |
| AI5031 | AI_SERVICE_UNAVAILABLE | 503 | AI_Engine 응답 실패 (재시도/템플릿 대체 후에도 실패) |
| E5001 | INTERNAL_SERVER_ERROR | 500 | 서버 내부 오류 |

> 도메인별로 에러가 늘어나면 동일 접두사 내에서 번호를 이어서 부여한다 (예: 인증 도메인 추가 에러는 `A4012`, `A4013`...).

## Non-Functional Considerations

- **인증 흐름**: Android Kakao/Naver SDK가 발급한 Provider Access Token을 그대로 검증하므로, 백엔드는 Redirect URI 기반 Authorization Code 교환 로직을 구현하지 않는다.
- **푸시**: APNs는 대상에서 제외하고 FCM(Android)만 지원한다.
- **결제**: Android 인앱결제(Google Play Billing) 정책상 디지털 재화(토큰/구독)는 Play Billing 연동이 필요할 수 있으므로, PG사 직결제 도입 전 Google Play 정책 검토가 필요하다.
- **실시간 채팅**: Socket.IO 클라이언트는 Android 전용으로 단일 플랫폼 기준 룸 관리(`community:{id}`)만 고려한다.
- **요청 추적**: 모든 요청에 `X-Request-Id` 헤더를 부여하고 응답에 동일 값을 포함한다.
