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

> **source of truth는 [`prisma/schema.prisma`](../prisma/schema.prisma)다.** 컬럼/타입/제약조건/관계의 정확한 내용은 항상 스키마 파일을 직접 확인한다. 이 섹션은 도메인별 테이블 역할을 빠르게 훑기 위한 요약이며, 스키마가 바뀔 때마다 표를 다시 베끼지 않는다 (예전엔 그렇게 하다가 스키마와 문서가 어긋나는 문제가 반복됐다).

### 현재 구현 범위 (1차 제출 P0 기준, `prisma/schema.prisma`에 반영됨)

| 도메인 | 테이블 | 역할 |
|---|---|---|
| 인증 | `Users` | 서비스 사용자 본체 (name, school_or_job, birth_date 등). 로그인 수단 정보는 갖지 않음 |
| 인증 | `Auth_Identities` | `Users` 1 : N 관계. 카카오/네이버/이메일 로그인 수단을 각각 한 행으로 저장 (email 방식만 `password_hash` 사용) |
| 인증 | `Refresh_Tokens` | JWT Refresh Token, 기기정보, 폐기(revoked) 여부 |
| 인증 | `Terms` | 이용약관/개인정보처리방침 버전 관리 |
| 프로필/온보딩 | `User_Profiles` | 닉네임, 성향, 레벨/XP, 온보딩 진행 상태 (온보딩 중 단계별로 채워지므로 대부분 nullable) |
| 프로필/온보딩 | `Goals` | 개인 목표/하루 대화 목표 |
| 미션 | `Missions` | 미션 템플릿 (제목/난이도/카테고리/보상 XP) |
| 미션 | `Mission_Prep_Items` | 미션별 준비 질문/시작 문장/팁 |
| 미션 | `Mission_Saves` | 미션 저장(북마크) |
| 미션 | `Mission_Records` | 미션 수행 결과, XP 지급 내역과 연결 |
| 대화 | `Conversations` | 미션 기반 대화 세션 |
| 대화 | `Conversation_Messages` | 대화 메시지 |
| 성장 | `XP_History` | XP 지급/차감 내역 (레벨 시스템의 원장) |
| 피드백/아카이브 | `Feedbacks` | AI 피드백 점수(친절함/주도성/공감/질문 연결성) |
| 피드백/아카이브 | `Saved_Phrases` | 저장한 문장 |

### 아직 스키마에 없는 범위 (기획 단계, P1 이후)

커뮤니티/모임, 결제/구독, 리포트, 알림(FCM), 아카이브 폴더, 안전(차단/신고), 캘린더 관련 테이블(`Communities`, `Community_Members`, `Community_Join_Requests`, `Chat_Messages`, `Plans`, `Subscriptions`, `Payments`, `Reports`, `Notifications`, `Notification_Settings`, `Device_Tokens`, `Archive_Folders`, `Archive_Items`, `Badges`, `User_Badges`, `Blocked_Users`, `Safety_Reports`, `Calendar_Events`, `Usage` 등)은 기획 ERD에는 존재하지만 아직 `prisma/schema.prisma`에 반영되지 않았다. 해당 도메인 구현이 시작되면 스키마에 먼저 추가하고, 이 표도 같이 갱신한다.

## API Specification

### Base URL

```
/api/v1
```

### Common Response Format

```json
{
  "success": true,
  "message": "OK",
  "data": { ... },
  "errorCode": null
}
```

### Common Error Format

```json
{
  "success": false,
  "message": "입력값이 올바르지 않습니다",
  "data": null,
  "errorCode": "VALIDATION_ERROR"
}
```

- `errorCode`는 SCREAMING_SNAKE_CASE 문자열 코드다. 전체 목록은 `## Error Codes` 참고.
- 기능명세서 PDF 원안은 `{ success, message, data }`까지만 제시했지만, 클라이언트가 에러 종류를 분기 처리할 수 있도록 팀 논의를 거쳐 `errorCode` 필드를 추가했다.
- 검증 실패 시 필드별 상세 정보(어떤 필드가 왜 틀렸는지)를 어디에 실을지는 아직 미정이다. 우선은 `message` 문자열로만 표현한다.

### Auth APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /auth/oauth/kakao | 카카오 로그인 |
| POST | /auth/oauth/naver | 네이버 로그인 |
| POST | /auth/signup | 이메일 회원가입 |
| POST | /auth/login | 이메일 로그인 |
| POST | /auth/email/request | 이메일 인증번호 발송 |
| POST | /auth/email/verify | 이메일 인증번호 확인 |
| POST | /auth/refresh | Access Token 재발급 |
| POST | /auth/logout | 로그아웃 |
| GET | /terms/latest | 약관/개인정보 동의 항목 조회 |

> 계정 삭제 API는 Auth 도메인이 아니라 `DELETE /api/v1/users/me`(G103 안전/개인정보 설정)에 정의되어 있다. Profile & Settings APIs 섹션은 이번 PR 범위 밖이라 아직 PDF 기준으로 갱신되지 않았다 (별도 이슈 필요).

> **소셜 로그인(Android 클라이언트) 인증 방식**: 프론트엔드가 Android 네이티브 앱으로 고정되므로, Kakao SDK / Naver SDK가 디바이스에서 로그인을 처리하고 **Provider Access Token**을 앱에 직접 발급한다. 백엔드는 Authorization Code → Token 교환을 수행하지 않고, **클라이언트가 전달한 Provider Access Token을 그대로 카카오/네이버의 사용자 정보 조회 API에 전달해 검증**하는 방식으로 구현한다. (기능명세서 반영 이후에도 이 방식을 유지하기로 재확인함)
>
> **이메일 로그인**: `/auth/signup`은 이메일 인증(`/auth/email/request` → `/auth/email/verify`) 완료 후 비밀번호와 이름/생년월일/학교·직업을 받아 계정을 생성한다. 비밀번호는 8자 이상 + 숫자 + 영문 + 특수문자 포함 규칙을 적용하고 bcrypt로 해시하여 저장한다.
>
> **계정 연동**: 카카오/네이버/이메일 중 이미 가입된 이메일로 다른 수단의 로그인을 시도하면, 새 계정을 만들지 않고 응답에 계정 연동 안내 정보를 포함한다.

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
  "message": "토큰이 부족합니다",
  "data": null,
  "errorCode": "INSUFFICIENT_TOKENS"
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
  "message": "결제에 실패했습니다. 다른 결제 수단을 시도해주세요",
  "data": null,
  "errorCode": "PAYMENT_FAILED"
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

### Goal APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /goals | 목표 목록 조회 |
| POST | /goals | 목표 생성 |
| PATCH | /goals/:goalId | 목표 수정 |
| DELETE | /goals/:goalId | 목표 삭제 |

#### GET /goals

**Response (200):**
```json
{
  "success": true,
  "data": {
    "goals": [
      {
        "id": "goal-001",
        "goalType": "daily_mission",
        "target": "2",
        "isActive": true,
        "createdAt": "2025-07-01T00:00:00Z"
      }
    ]
  }
}
```

#### POST /goals

**Request Body:**
```json
{
  "goalType": "daily_mission",
  "target": "3"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": { "goalId": "goal-002" }
}
```

#### PATCH /goals/:goalId

**Request Body:**
```json
{
  "target": "5",
  "isActive": true
}
```

**Response (200):**
```json
{ "success": true, "data": null }
```

#### DELETE /goals/:goalId

**Response (200):**
```json
{ "success": true, "data": null }
```

목표 조회/수정/삭제는 모두 `NOT_FOUND`(존재하지 않거나 본인 소유가 아닌 goalId) 공통 에러 코드를 사용한다.

## Push Notification 발송 정책 (Android / FCM)

- `Notification_Settings`의 항목별 동의 여부를 확인한 뒤에만 발송한다.
- 발송 대상 토큰은 `Device_Tokens`에서 `user_id` 기준 최신 토큰을 조회한다.
- FCM 응답이 `UNREGISTERED` / `INVALID_ARGUMENT`이면 해당 토큰을 `Device_Tokens`에서 즉시 삭제한다.
- 발송 유형: 미션 리마인드(`mission_reminder`), 커뮤니티 채팅 알림(`community_chat`), 토큰 부족 경고(`token_warning`), 마케팅(`marketing`).

## Error Codes

에러 코드는 **SCREAMING_SNAKE_CASE 문자열**을 사용한다. 접두사 규칙은 없으며, 코드 이름 자체가 곧 문서다. 같은 도메인 안에서도 에러 종류별로 별도 클래스(`*.error.ts`)를 만들고, 공통 `AppError`를 상속해 `errorCode`/`statusCode`/`message`/`data`를 갖도록 한다.

**공통 에러 코드**

기능명세서 PDF가 명시한 공통 코드는 `VALIDATION_ERROR`, `UNAUTHORIZED`, `NOT_FOUND`, `DUPLICATED`, `SERVER_ERROR` 5개다. `FORBIDDEN`은 PDF에 없음 — 403이 필요한 케이스가 생기면 그때 확정한다.

| Code | HTTP Status | Description |
|------|-------------|-------------|
| VALIDATION_ERROR | 400 | 요청 데이터 유효성 검증 실패 |
| UNAUTHORIZED | 401 | Access Token 누락/만료/무효 |
| FORBIDDEN | 403 | 권한 없음 (PDF에는 없음) |
| NOT_FOUND | 404 | 리소스를 찾을 수 없음 |
| DUPLICATED | 409 | 리소스 중복 (일반) |
| SERVER_ERROR | 500 | 서버 내부 오류 |

**도메인별 세부 코드 (예시)**

`INSUFFICIENT_TOKENS`, `COMMUNITY_FULL`, `PAYMENT_FAILED`, `AI_SERVICE_UNAVAILABLE`는 PDF에 명시된 적이 없다. 특히 `INSUFFICIENT_TOKENS`는 새 ERD에 `Token_Accounts`/`Token_Transactions` 테이블 자체가 보이지 않아(`XP_History`/`Usage`/`Plans`로 대체된 것으로 추정) 토큰 시스템 개념 자체가 아직 유효한지 불확실하다. 해당 도메인(토큰/커뮤니티/결제/AI 코칭) 담당자가 확인 후 정리해야 한다.

| Code | HTTP Status | Description | 출처 |
|------|-------------|-------------|------|
| DUPLICATED_EMAIL | 409 | 이미 가입된 이메일 | PDF (A103) |
| INVALID_VERIFICATION_CODE | 400 | 이메일 인증번호 불일치/만료 | PDF (A103) |
| TERMS_REQUIRED | 400 | 필수 약관 미동의 | PDF (A103) |
| FEEDBACK_NOT_READY | 202 | AI 피드백이 아직 준비되지 않음 | PDF (예외 E-1) |
| FEEDBACK_INPUT_TOO_SHORT | 400 | 피드백 생성에 필요한 대화 분량 부족 | PDF (예외 E-1) |
| INSUFFICIENT_TOKENS | 402 | 토큰 잔여량 부족 | PDF에 없음, 재검토 필요 |
| COMMUNITY_FULL | 409 | 모임 정원 초과 (대기 등록으로 처리) | PDF에 없음, 재검토 필요 |
| PAYMENT_FAILED | 402 | 결제 처리 실패 | PDF에 없음, 재검토 필요 |
| AI_SERVICE_UNAVAILABLE | 503 | AI_Engine 응답 실패 (재시도/템플릿 대체 후에도 실패) | PDF에 없음, 재검토 필요 |

> 도메인별 세부 코드는 필요할 때마다 위 표에 추가한다. 이름은 다른 도메인 코드와 겹치지 않게, 의미가 분명하도록 짓는다.

## Non-Functional Considerations

- **인증 흐름**: Android Kakao/Naver SDK가 발급한 Provider Access Token을 그대로 검증하므로, 백엔드는 Redirect URI 기반 Authorization Code 교환 로직을 구현하지 않는다.
- **푸시**: APNs는 대상에서 제외하고 FCM(Android)만 지원한다.
- **결제**: Android 인앱결제(Google Play Billing) 정책상 디지털 재화(토큰/구독)는 Play Billing 연동이 필요할 수 있으므로, PG사 직결제 도입 전 Google Play 정책 검토가 필요하다.
- **실시간 채팅**: Socket.IO 클라이언트는 Android 전용으로 단일 플랫폼 기준 룸 관리(`community:{id}`)만 고려한다.
- **요청 추적**: 모든 요청에 `X-Request-Id` 헤더를 부여하고 응답에 동일 값을 포함한다.
