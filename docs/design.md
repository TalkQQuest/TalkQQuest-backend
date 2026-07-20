# Design Document

## Overview

TalkQuest 백엔드는 Node.js + Express.js 기반 REST API 서버로 구현됩니다.
인증, 미션, 대화, 커뮤니티, 결제 등 도메인별 모듈로 분리하며,
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
| 이메일 발송 | Resend (RESEND_API_KEY 미설정 시 로그 출력으로 폴백) |

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
│   ├── auth.ts              # JWT 직접 검증 (authenticate/authorizeUser)
│   ├── tsoaAuthentication.ts # tsoa @Security("bearerAuth") 연결부
│   ├── errorHandler.ts
│   ├── requestId.ts
│   └── validator.ts
├── modules/               # 도메인별 모듈 (controller → service → repository)
│   ├── auth/                # 소셜/이메일 로그인, 토큰 재발급/로그아웃, 약관
│   ├── user/                 # 프로필, 온보딩, 목표(Goal)
│   ├── mission/              # 미션 목록/상세/저장/완료
│   ├── conversations/        # 대화 세션/메시지
│   ├── community/
│   ├── payment/
│   ├── report/
│   └── notification/        # FCM 푸시 발송
├── shared/                # 공통 유틸리티
│   ├── errors/
│   ├── utils/
│   └── constants/
├── generated/             # tsoa가 생성하는 routes.ts (자동 생성, 수정 금지)
│   └── routes.ts
└── prisma/
    ├── schema.prisma
    └── migrations/
```

> 라우팅은 `*.routes.ts`를 수동 작성하지 않고, 컨트롤러에 `@Route`/`@Get`/`@Post` 등 tsoa 데코레이터를 붙여 빌드 시 `tsoa spec-and-routes`가 `generated/routes.ts`와 `swagger.json`을 자동 생성한다.
> 인증이 필요한 API는 `@Security("bearerAuth")`(Swagger 문서화용) + `@Middlewares(authorizeUser())`(실제 JWT 검증)를 함께 붙인다.

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

> **source of truth는 [`prisma/schema.prisma`](../prisma/schema.prisma)다.** 컬럼/타입/제약조건/관계의 정확한 내용은 항상 스키마 파일을 직접 확인한다. 이 섹션은 도메인별 테이블 역할을 빠르게 훑기 위한 요약이며, 스키마가 바뀔 때마다 표를 다시 베끼지 않는다.

### 현재 구현 범위 (`prisma/schema.prisma`에 반영됨)

| 도메인 | 테이블 | 역할 |
|---|---|---|
| 인증 | `Users` | 서비스 사용자 본체 (name, school_or_job, birth_date 등). 로그인 수단 정보는 갖지 않음 |
| 인증 | `Auth_Identities` | `Users` 1 : N 관계. 카카오/네이버/이메일 로그인 수단을 각각 한 행으로 저장 (email 방식만 `password_hash` 사용) |
| 인증 | `Refresh_Tokens` | JWT Refresh Token, 기기정보, 폐기(revoked) 여부 |
| 인증 | `Terms` | 이용약관/개인정보처리방침 버전 관리 |
| 프로필/온보딩 | `User_Profiles` | 닉네임, 성향, 레벨/XP, 온보딩 진행 상태. 회원가입 시 `Users`와 함께 즉시 생성됨 |
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

### 아직 스키마에 없는 범위 (API 명세서에는 있으나 미구현)

커뮤니티/모임, 결제/구독, 리포트, 알림(FCM), 아카이브 폴더, 안전(차단/신고), 캘린더, 배지 관련 테이블은 API 명세서 기준으로는 확정됐지만 아직 `prisma/schema.prisma`에 반영되지 않았다. 해당 도메인 구현이 시작되면 스키마에 먼저 추가하고, 이 표도 같이 갱신한다.

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
- 검증 실패 시 필드별 상세 정보(어떤 필드가 왜 틀렸는지)를 어디에 실을지는 아직 미정이다. 우선은 `message` 문자열로만 표현한다.

### Auth APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /auth/oauth/kakao | 카카오 로그인 |
| POST | /auth/oauth/naver | 네이버 로그인 |
| POST | /auth/signup | 이메일 회원가입 |
| POST | /auth/register | 이메일 회원가입 (signup과 동일 핸들러) |
| POST | /auth/login | 이메일 로그인 |
| POST | /auth/email/request | 이메일 인증코드 발송 |
| POST | /auth/email/verify | 이메일 인증코드 확인 |
| POST | /auth/refresh | Access Token 재발급 |
| POST | /auth/logout | 로그아웃 (Authorization 필수) |
| GET | /legal/terms | 이용약관 조회 |
| GET | /legal/privacy | 개인정보처리방침 조회 |

> 계정 삭제 API(`DELETE /api/v1/users/me`)는 Auth 도메인이 아니라 User 도메인에 속하며 아직 미구현이다.
>
> **소셜 로그인(Android 클라이언트) 인증 방식**: Kakao SDK / Naver SDK가 디바이스에서 로그인을 처리하고 **Provider Access Token**을 앱에 직접 발급한다. 백엔드는 Authorization Code → Token 교환을 수행하지 않고, **클라이언트가 전달한 Provider Access Token을 그대로 카카오/네이버의 사용자 정보 조회 API에 전달해 검증**한다. API 명세서 원안은 Authorization Code 방식(`code`/`state`)으로 작성되어 있으나, 팀 논의로 Provider Access Token 방식을 유지하기로 확정했다 — 명세서보다 실제 구현이 우선한다.
>
> **이메일 로그인**: `/auth/signup`(`/auth/register`)은 이메일 인증(`/auth/email/request` → `/auth/email/verify`) 완료 후 비밀번호와 이름/생년월일/학교·직업, `termsAgreedAt`(ISO 8601 동의 시각)을 받아 계정을 생성한다. 비밀번호는 8자 이상 + 숫자 + 영문 + 특수문자 포함 규칙을 적용하고 bcrypt로 해시하여 저장한다. 이메일 중복 여부는 `/auth/email/request` 시점에 이미 체크한다.
>
> **계정 연동**: 카카오/네이버 로그인 시, 같은 이메일로 다른 수단이 이미 가입되어 있으면 새 계정을 만들지 않고 응답에 `needsLinking: true`와 기존 계정 정보를 포함한다(토큰은 발급하지 않음). 실제로 두 계정을 병합하는 API는 아직 없다.

#### POST /auth/oauth/kakao

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
  "message": "OK",
  "data": {
    "accessToken": "string | null",
    "refreshToken": "string | null",
    "expiresIn": 3600,
    "isNewUser": true,
    "needsLinking": false,
    "user": {
      "id": "uuid",
      "email": "string | null",
      "nickname": "string | null",
      "provider": "kakao"
    }
  },
  "errorCode": null
}
```

`needsLinking: true`인 경우 `accessToken`/`refreshToken`/`expiresIn`은 모두 `null`이다.

#### POST /auth/oauth/naver

**Request Body:** `/auth/oauth/kakao`와 동일 구조

**Response (200):** `/auth/oauth/kakao`와 동일 구조, `provider: "naver"`

#### POST /auth/signup, POST /auth/register

**Request Body:**
```json
{
  "email": "test@example.com",
  "password": "Test1234!",
  "name": "홍길동",
  "birthDate": "2000-01-01",
  "schoolOrJob": "한성대학교",
  "termsAgreedAt": "2025-07-03T12:00:00Z"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "OK",
  "data": {
    "userId": "uuid",
    "accessToken": "string",
    "refreshToken": "string"
  },
  "errorCode": null
}
```

#### POST /auth/login

**Request Body:**
```json
{ "email": "test@example.com", "password": "Test1234!" }
```

**Response (200):**
```json
{
  "success": true,
  "message": "OK",
  "data": {
    "accessToken": "string",
    "refreshToken": "string",
    "tokenType": "Bearer"
  },
  "errorCode": null
}
```

#### POST /auth/email/request

**Request Body:** `{ "email": "test@example.com" }`

이메일 형식 검증 + 이미 가입된 이메일(수단 무관)인지 체크 후 인증번호를 발급한다. Redis에 5분 TTL로 저장하고, `RESEND_API_KEY`가 설정돼 있으면 실제 메일을 발송한다(없으면 서버 로그로만 출력).

#### POST /auth/email/verify

**Request Body:** `{ "email": "test@example.com", "code": "483921" }`

코드 불일치와 만료(또는 발급 이력 없음)를 구분해서 에러를 반환한다 (`## Error Codes` 참고). 인증 성공 시 30분간 signup 가능 상태로 표시된다.

#### POST /auth/refresh

**Request Body:** `{ "refreshToken": "string" }`

**Response (200):** `{ "success": true, "message": "OK", "data": { "accessToken": "string" }, "errorCode": null }`

새 Refresh Token은 발급하지 않는다.

#### POST /auth/logout

**Header:** `Authorization: Bearer {accessToken}` 필수

**Request Body:** `{ "refreshToken": "string" }`

전달된 Refresh Token을 DB에서 폐기(revoked) 처리한다.

#### GET /legal/terms, GET /legal/privacy

**Response (200):**
```json
{
  "success": true,
  "message": "OK",
  "data": {
    "type": "terms",
    "version": "1.0.0",
    "content": "string",
    "createdAt": "ISODate"
  },
  "errorCode": null
}
```

활성화된 약관이 없으면 404 `NOT_FOUND`.

### User APIs (프로필/온보딩/목표)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /users/me | 내 프로필 조회 |
| PATCH | /users/me | 내 프로필 수정 |
| PATCH | /users/me/onboarding | 온보딩 단계별 저장 |
| POST | /users/me/onboarding/complete | 온보딩 완료 처리 |
| GET | /goals | 목표 목록 조회 |
| POST | /goals | 목표 생성 |
| PATCH | /goals/{goalId} | 목표 수정 |
| DELETE | /goals/{goalId} | 목표 삭제 |

모두 `Authorization: Bearer {accessToken}` 필수.

> API 명세서에는 이 외에도 `DELETE /users/me`(회원 탈퇴), `GET /users/me/settings`/`PATCH /users/me/settings`(설정), `GET /users/me/usage`(사용량), `GET /users/me/dashboard`(마이페이지 요약), `GET /badges/me`(배지)가 정의되어 있으나 아직 구현되지 않았다.

#### GET /users/me

**Response (200):**
```json
{
  "success": true,
  "message": "OK",
  "data": {
    "id": "uuid",
    "name": "홍길동",
    "nickname": "길동이",
    "avatarUrl": "string | null",
    "bio": "string | null",
    "level": 3,
    "xp": 450,
    "dailyConversationGoal": 2,
    "onboardingCompleted": true
  },
  "errorCode": null
}
```

#### PATCH /users/me

**Request Body (모두 선택):**
```json
{
  "nickname": "string",
  "avatarUrl": "string (URL)",
  "bio": "string",
  "dailyConversationGoal": 2,
  "preferredStyle": "string",
  "interests": ["string"]
}
```

#### PATCH /users/me/onboarding

온보딩은 여러 단계(step)로 나뉘며, step 값에 따라 필수 필드가 다르다 (1: `personalityType`, 2: `difficultSituations`, 이후 단계는 `purpose` 등). 상세 단계 구성은 `src/modules/user/services/onboarding.service.ts` 참고.

**Request Body (step 1 예시):**
```json
{ "step": 1, "personalityType": "introvert" }
```

**Response (200):**
```json
{ "success": true, "message": "저장되었습니다.", "data": { "step": 1, "onboardingCompleted": false }, "errorCode": null }
```

#### POST /users/me/onboarding/complete

**Response (200):**
```json
{ "success": true, "message": "온보딩이 완료되었습니다.", "data": { "onboardingCompleted": true }, "errorCode": null }
```

#### GET /goals

**Response (200):**
```json
{
  "success": true,
  "message": "OK",
  "data": {
    "goals": [
      { "id": "uuid", "goalType": "daily_mission", "target": "2", "isActive": true, "createdAt": "ISODate" }
    ]
  },
  "errorCode": null
}
```

#### POST /goals

**Request Body:** `{ "goalType": "daily_mission", "target": "3" }`

**Response (200):** `{ "success": true, "message": "목표가 생성되었습니다.", "data": { "goalId": "uuid" }, "errorCode": null }`

#### PATCH /goals/{goalId}

**Request Body (모두 선택):** `{ "target": "5", "isActive": true }`

#### DELETE /goals/{goalId}

목표 조회/수정/삭제는 모두 `NOT_FOUND`(존재하지 않거나 본인 소유가 아닌 goalId) 공통 에러 코드를 사용한다.

### Mission APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /missions | 미션 목록 조회 (필터링: difficulty/category/saved, 페이지네이션) |
| GET | /missions/today | 오늘의 추천 미션 조회 |
| GET | /missions/{missionId} | 미션 상세 조회 |
| GET | /missions/{missionId}/prep | 대화 시작 준비 문장 조회 |
| POST | /missions/{missionId}/save | 미션 저장(북마크) |
| DELETE | /missions/{missionId}/save | 미션 저장 취소 |

모두 `Authorization: Bearer {accessToken}` 필수.

> API 명세서의 `GET /home/summary`(홈 대시보드/요약)는 아직 구현되지 않았다. XP 현황/히스토리(`GET /xp/summary`, `GET /xp/history`)는 아래 [XP APIs](#xp-apis) 참고.

#### GET /missions

**Query String:** `difficulty`("쉬움"|"보통"|"어려움"), `category`, `saved`(boolean), `page`, `size`

**Response (200):**
```json
{
  "success": true,
  "message": "OK",
  "data": {
    "missions": [
      {
        "id": "uuid",
        "title": "카페에서 바리스타에게 메뉴 추천 물어보기",
        "category": "string",
        "difficulty": "쉬움",
        "estimatedMinutes": 10,
        "rewardXp": 10,
        "isSaved": false
      }
    ],
    "pageInfo": { "currentPage": 1, "totalPages": 3, "totalCount": 42 }
  },
  "errorCode": null
}
```

#### GET /missions/{missionId}

**Response (200):** 위 목록 아이템 필드 + `description`, `preparationTip`, `caution`

#### GET /missions/{missionId}/prep

**Response (200):**
```json
{
  "success": true,
  "message": "OK",
  "data": {
    "missionId": "uuid",
    "totalCount": 3,
    "items": [{ "id": "uuid", "type": "question", "content": "string", "orderIndex": 0 }]
  },
  "errorCode": null
}
```

#### POST /missions/{missionId}/save

**Response (200):** `{ "success": true, "message": "미션이 저장되었습니다.", "data": { "missionId": "uuid", "isSaved": true, "savedAt": "ISODate" }, "errorCode": null }`

#### DELETE /missions/{missionId}/save

**Response (200):** `{ "success": true, "message": "미션 저장이 취소되었습니다.", "data": { "missionId": "uuid", "isSaved": false }, "errorCode": null }`

### Conversation APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /conversations | 대화 세션 생성 |
| GET | /conversations/{conversationId} | 대화 내역 조회 |
| GET | /conversations/{conversationId}/guide | 주제 도움/추천 문장 조회 |
| POST | /conversations/{conversationId}/messages | 메시지 저장/응답 생성 |
| GET | /conversations/{conversationId}/suggestions | 후속 질문/표현 추천 조회 |
| POST | /conversations/{conversationId}/finish | 대화 종료 |
| POST | /conversations/{conversationId}/complete | 미션 완료 처리 (결과/메모/소요시간 기록, XP 지급) |

모두 `Authorization: Bearer {accessToken}` 필수.

> API 명세서의 `POST /feedback`(대화 기반 피드백 생성), `GET /feedback/{feedbackId}`, `POST /feedback/{feedbackId}/retry`는 아직 구현되지 않았다. `POST /conversations/{conversationId}/complete`가 현재 "미션 완료" 처리를 겸하고 있다.

#### POST /conversations

**Request Body:** `{ "missionId": "uuid", "mode": "text" | "voice", "selectedTopic": "string (선택)" }`

**Response (201):**
```json
{
  "success": true,
  "message": "OK",
  "data": {
    "conversationId": "uuid",
    "missionId": "uuid",
    "missionTitle": "string",
    "mode": "text",
    "selectedTopic": "string | null",
    "status": "in_progress",
    "startedAt": "ISODate"
  },
  "errorCode": null
}
```

#### GET /conversations/{conversationId}

**Response (200):**
```json
{
  "success": true,
  "message": "OK",
  "data": {
    "conversationId": "uuid",
    "missionId": "uuid",
    "status": "in_progress",
    "startedAt": "ISODate",
    "finishedAt": "ISODate | null",
    "messages": [{ "id": "uuid", "role": "user", "content": "string", "createdAt": "ISODate" }]
  },
  "errorCode": null
}
```

#### POST /conversations/{conversationId}/messages

**Request Body:** `{ "role": "user", "content": "string" }`

**Response (200):**
```json
{
  "success": true,
  "message": "OK",
  "data": {
    "userMessage": { "id": "uuid", "role": "user", "content": "string", "createdAt": "ISODate" },
    "guideMessage": { "id": "uuid", "role": "guide", "content": "string", "createdAt": "ISODate" }
  },
  "errorCode": null
}
```

#### POST /conversations/{conversationId}/finish

**Request Body:** `{ "status": "completed" | "abandoned" }`

**Response (200):**
```json
{
  "success": true,
  "message": "OK",
  "data": {
    "conversationId": "uuid",
    "status": "completed",
    "finishedAt": "ISODate",
    "summary": { "messageCount": 12, "durationMinutes": 8 }
  },
  "errorCode": null
}
```

#### POST /conversations/{conversationId}/complete

**Request Body:**
```json
{
  "conversationId": "uuid",
  "result": "success | failure | avoidance",
  "memo": "string (선택)",
  "durationMinutes": 5,
  "emotion": "string (선택)"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "미션을 완료했습니다.",
  "data": {
    "missionRecordId": "uuid",
    "status": "completed",
    "xpEarned": 10,
    "completedAt": "ISODate"
  },
  "errorCode": null
}
```

### XP APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /xp/summary | XP/레벨 요약 조회 |
| GET | /xp/history | XP 획득/차감 내역 조회 (페이지네이션) |

모두 `Authorization: Bearer {accessToken}` 필수.

> **XP 데이터 모델 주의** — XP는 두 곳에 나뉘어 저장된다.
> - `User_Profiles.xp`는 **현재 레벨 내 진행도**다. 레벨업 시 `xp -= 필요XP`로 차감되므로 **누적 총합이 아니다.**
> - `XP_History`가 지급/차감 원장이며, **누적 경험치는 이 테이블의 `amount` 합계**로 구한다(차감은 음수로 기록되어 순증분이 된다).
>
> 그래서 `/xp/summary`는 `currentXp`(레벨 내 진행도)와 `totalXp`(누적)를 **분리해서** 내려준다. 둘을 같은 값으로 취급하면 안 된다.
>
> `nextLevelXp`는 미션 완료 시 레벨업 판정과 **반드시 같은 공식**이어야 한다(어긋나면 진행바가 꽉 찼는데 레벨업이 안 되는 현상이 생긴다). 공식은 `src/modules/xp/services/level.service.ts`의 `calculateNextLevelXp` 하나로 관리하며, 미션 완료 로직(`mission-completion.service.ts`)도 이 함수를 import해서 쓴다. 현재 값은 `level * 100`이나 **기획 미확정 상태**이며, 변경 시 이 함수만 수정하면 양쪽에 함께 반영된다.

#### GET /xp/summary

**Response (200):**
```json
{
  "success": true,
  "message": "OK",
  "data": {
    "level": 3,
    "currentXp": 120,
    "nextLevelXp": 300,
    "totalXp": 1520
  },
  "errorCode": null
}
```

| 필드 | 설명 |
|---|---|
| `level` | 현재 레벨 |
| `currentXp` | 현재 레벨 내 진행도 (누적 아님) |
| `nextLevelXp` | 다음 레벨까지 필요한 XP |
| `totalXp` | 누적 경험치 (`XP_History` 합계, 지급 이력이 없으면 `0`) |

**Errors:** 프로필이 없으면 `NOT_FOUND`(404).

#### GET /xp/history

**Query String:** `page`(기본 1), `size`(기본 10, 최대 100)

최신순(`created_at` 내림차순)으로 반환한다.

**Response (200):**
```json
{
  "success": true,
  "message": "OK",
  "data": {
    "items": [
      {
        "id": "uuid",
        "amount": 20,
        "reason": "미션 완료",
        "referenceId": "uuid",
        "referenceType": "mission_record",
        "createdAt": "ISODate"
      }
    ],
    "pageInfo": { "currentPage": 1, "totalPages": 3, "totalCount": 25 }
  },
  "errorCode": null
}
```

| 필드 | 설명 |
|---|---|
| `amount` | 양수=획득, **음수=차감** |
| `referenceId` | 관련 리소스 ID (직접 지급 등은 `null`) |
| `referenceType` | `mission_record` / `badge` / `event` 등 (없으면 `null`) |

**Errors:** 잘못된 `page`/`size`는 `VALIDATION_ERROR`(400).

> 배지 관련 API(`GET /badges`, `POST /badges/grant`)는 기능명세서 J101에 함께 묶여 있으나 아직 구현되지 않았다.

### Community APIs (미구현)

API 명세서에는 정의되어 있으나 아직 스키마/코드 모두 구현되지 않았다. 상세 요청/응답 형식은 담당자가 구현 시점에 각 Notion 문서를 참고해 작성한다.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /communities | 커뮤니티 목록 |
| POST | /communities | 모임 생성 임시 저장 |
| GET | /communities/recommendations | 유사 모임 추천 |
| GET | /communities/me | 나의 참여/대기/북마크 커뮤니티 |
| GET | /communities/join-requests/me | 내 커뮤니티 신청 상태 조회 |
| GET | /communities/{communityId} | 커뮤니티 상세 |
| PATCH | /communities/{communityId} | 모임 수정 |
| POST | /communities/{communityId}/publish | 모임 게시 |
| GET | /communities/{communityId}/my-status | 내 참여 상태 조회 |
| GET | /communities/{communityId}/chat-preview | 채팅방 미리보기 |
| POST | /communities/{communityId}/join-requests | 커뮤니티 참여 신청 |
| GET | /communities/{communityId}/join-requests | 모임 신청자 목록 조회 |
| POST | /communities/{communityId}/join-requests/{requestId}/approve | 모임 신청자 승인 |
| POST | /communities/{communityId}/join-requests/{requestId}/reject | 모임 신청자 거절 |
| DELETE | /communities/join-requests/{requestId} | 커뮤니티 신청 취소 |
| POST | /communities/{communityId}/waitlist | 커뮤니티 대기 등록 |
| PATCH | /communities/{communityId}/waitlist/order | 모임 대기자 순서 변경 |
| DELETE | /communities/{communityId}/leave | 참여 취소 |
| POST | /communities/{communityId}/messages | 호스트에게 메시지 보내기 |
| POST | /uploads/community-cover | 모임 커버 이미지 업로드 |
| POST | /calendar/events | 승인 모임 일정 추가 |

채팅 메시지는 REST 저장과 동시에 Socket.IO 채널(`community:{id}`)로 실시간 브로드캐스트할 예정이다 (미구현).

### Payment & Subscription APIs (미구현)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /plans | 플랜 목록 조회 |
| POST | /subscriptions | 구독 시작 |
| GET | /subscriptions/me | 내 구독 정보 조회 |
| DELETE | /subscriptions/me | 구독 취소 |
| POST | /payments | 결제 요청 |
| GET | /payments/me | 결제 내역 조회 |

> 이전 초안에 있던 `POST /payments/webhook`(PG사 Webhook 수신)은 현재 API 명세서에는 없다. 실제 PG사 연동 시 필요 여부를 다시 확인한다.
> **결제**: Android 인앱결제(Google Play Billing) 정책상 디지털 재화(구독)는 Play Billing 연동이 필요할 수 있으므로, PG사 직결제 도입 전 Google Play 정책 검토가 필요하다.

### Report & Feedback APIs (미구현)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /reports | 리포트 목록 조회 |
| GET | /reports/{reportId} | 리포트 상세 조회 |
| GET | /reports/weekly-compare | 주간 비교 리포트 조회 |
| GET | /reports/monthly?month=YYYY-MM | 월간 리포트 조회 |
| POST | /feedback | 대화 기반 피드백 생성 |
| GET | /feedback/{feedbackId} | 피드백 상세 조회 |
| POST | /feedback/{feedbackId}/retry | 피드백 재시도 |
| POST | /reports/{reportId}/archive | 리포트 아카이브 저장 |

### Archive APIs (미구현)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /archives/summary | 아카이브 카운트/최근 활동 조회 |
| GET | /archives/search | 검색 및 필터 |
| GET | /archive-folders | 폴더 목록 조회 |
| POST | /archive-folders | 새 폴더 생성 |
| PATCH | /archive-folders/{folderId} | 폴더명 수정 |
| POST | /archive-folders/{folderId}/items | 항목 폴더 저장 |
| DELETE | /archives/items/{itemId} | 아카이브 항목 삭제 |
| POST | /archives/phrases | 문장 저장 |
| GET | /archives/phrases/{phraseId} | 저장 문장 상세 조회 |
| GET | /archives/conversations/{conversationId} | 대화 기록 상세 조회 |

### Notification APIs (미구현)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /notifications | 알림 목록 조회 |
| PATCH | /notifications/{notificationId}/read | 알림 읽음 처리 |
| PATCH | /notifications/all/read | 알림 전체 읽음 처리 |
| GET | /notifications/settings | 알림 설정 조회 |
| PATCH | /notifications/settings | 알림 설정 수정 |

**Push Notification 발송 정책 (Android / FCM, 미구현)**

- 알림 설정의 항목별 동의 여부를 확인한 뒤에만 발송한다.
- 발송 대상 토큰은 기기 토큰 저장소에서 `user_id` 기준 최신 토큰을 조회한다.
- FCM 응답이 `UNREGISTERED` / `INVALID_ARGUMENT`이면 해당 토큰을 즉시 삭제한다.

### Safety & Settings APIs (미구현)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /safety/blocked-users | 차단 목록 조회 |
| POST | /safety/blocked-users | 유저 차단 |
| DELETE | /safety/blocked-users | 유저 차단 해제 |
| GET | /users/me/settings | 설정 조회 |
| PATCH | /users/me/settings | 설정 수정 |
| DELETE | /users/me | 회원 탈퇴 |
| POST | /uploads/profile-image | 프로필 이미지 업로드 |
| GET | /badges/me | 보유 배지 목록 조회 |
| GET | /users/me/usage | 사용량 조회 |
| GET | /users/me/dashboard | 마이페이지 요약 |
| GET | /home/summary | 홈 대시보드/요약 |

## Error Codes

에러 코드는 **SCREAMING_SNAKE_CASE 문자열**을 사용한다. 접두사 규칙은 없으며, 코드 이름 자체가 곧 문서다. 같은 도메인 안에서도 에러 종류별로 별도 클래스(`*.error.ts`)를 만들고, 공통 `AppError`를 상속해 `errorCode`/`statusCode`/`message`/`data`를 갖도록 한다.

**공통 에러 코드**

| Code | HTTP Status | Description |
|------|-------------|-------------|
| VALIDATION_ERROR | 400 | 요청 데이터 유효성 검증 실패 |
| UNAUTHORIZED | 401 | Access Token 누락/만료/무효, 위변조/revoked된 Refresh Token |
| FORBIDDEN | 403 | 권한 없음 / 탈퇴한 계정 |
| NOT_FOUND | 404 | 리소스를 찾을 수 없음 |
| DUPLICATED | 409 | 리소스 중복 (일반, 이메일 중복 포함) |
| EXPIRED | 410 | 인증번호/토큰 등이 만료됨 |
| SERVER_ERROR | 500 | 서버 내부 오류 |

**도메인별 세부 코드**

| Code | HTTP Status | Description |
|------|-------------|-------------|
| UNVERIFIED_EMAIL | 422 | 이메일 인증이 완료되지 않음 (회원가입 시) |
| INVALID_PASSWORD | 400 | 이메일 로그인 비밀번호 불일치 |
| INSUFFICIENT_TOKENS | 402 | 토큰 잔여량 부족 (토큰/AI 코칭 도메인, 미구현) |
| COMMUNITY_FULL | 409 | 모임 정원 초과 (커뮤니티 도메인, 미구현) |
| PAYMENT_FAILED | 402 | 결제 처리 실패 (결제 도메인, 미구현) |
| AI_SERVICE_UNAVAILABLE | 503 | AI 응답 생성 실패 (대화/피드백 도메인, 재시도 후에도 실패) |

> 도메인별 세부 코드는 필요할 때마다 위 표에 추가한다. 이름은 다른 도메인 코드와 겹치지 않게, 의미가 분명하도록 짓는다. 각 도메인 담당자가 구현 시점에 실제 사용하는 코드로 갱신한다.

## Non-Functional Considerations

- **인증 흐름**: Android Kakao/Naver SDK가 발급한 Provider Access Token을 그대로 검증하므로, 백엔드는 Redirect URI 기반 Authorization Code 교환 로직을 구현하지 않는다 (API 명세서 원안과 다르게 유지하기로 확정한 부분, `### Auth APIs` 참고).
- **이메일 발송**: Resend를 사용하며, API 키가 없는 로컬 개발 환경에서는 인증번호를 서버 로그로만 출력한다. Resend 미인증 도메인 상태에서는 계정 소유자 이메일로만 실제 발송이 가능하다.
- **인증 상태 저장**: 이메일 인증번호/인증완료 상태는 DB 테이블이 아니라 Redis에 TTL로 저장한다 (인증번호 5분, 인증완료 후 회원가입 유예 30분).
- **푸시**: APNs는 대상에서 제외하고 FCM(Android)만 지원한다 (미구현).
- **결제**: Android 인앱결제(Google Play Billing) 정책상 디지털 재화(구독)는 Play Billing 연동이 필요할 수 있으므로, PG사 직결제 도입 전 Google Play 정책 검토가 필요하다 (미구현).
- **실시간 채팅**: Socket.IO 클라이언트는 Android 전용으로 단일 플랫폼 기준 룸 관리(`community:{id}`)만 고려한다 (미구현).
- **요청 추적**: 모든 요청에 `X-Request-Id` 헤더를 부여하고 응답에 동일 값을 포함한다.
