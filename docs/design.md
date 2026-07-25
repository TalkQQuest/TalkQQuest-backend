# Design Document

## Overview

TalkQuest 백엔드는 Node.js + Express.js 기반 REST API 서버로 구현됩니다.
인증, 미션, 대화, 아카이브, 피드백/리포트, 배지, 결제 등 도메인별 모듈로 분리하며,
MySQL을 주 데이터베이스로, Redis를 세션/캐시 저장소로 사용합니다.
커뮤니티/모임 도메인은 아직 스키마/코드 모두 구현되지 않았습니다.

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
| LLM | Upstage Solar (미션 추천, 대화 가이드 응답, AI 피드백 생성) |
| Push Notification | Firebase Cloud Messaging (FCM, Android) — 설정/저장 API는 구현됨, 실제 발송 로직은 미구현 |
| Payment | mock 구현 (실제 PG 연동 없음, 사업자등록증 미비) |
| 이메일 발송 | Resend (RESEND_API_KEY 미설정 시 로그 출력으로 폴백) |
| 파일 업로드 | AWS S3 (프로필 이미지, multer 메모리 스토리지 → S3 직접 업로드) |

### 디렉토리 구조

```
src/
├── app.ts                  # Express 앱 초기화
├── server.ts               # 서버 진입점
├── config/                 # 환경 설정
│   ├── database.ts
│   ├── redis.ts
│   ├── logger.ts
│   └── env.ts
├── middlewares/            # 공통 미들웨어
│   ├── auth.ts              # JWT 직접 검증 (authenticate/authorizeUser)
│   ├── tsoaAuthentication.ts # tsoa @Security("bearerAuth") 연결부
│   ├── errorHandler.ts
│   ├── requestId.ts
│   └── validator.ts
├── modules/               # 도메인별 모듈 (controller → service → repository)
│   ├── auth/                 # 소셜/이메일 로그인, 토큰 재발급/로그아웃, 약관, 비밀번호
│   ├── user/                  # 프로필, 온보딩, 목표(Goal), 사용량, 마이페이지 요약, 회원 탈퇴
│   ├── setting/                # 알림 수신 설정 (users/me/settings — notification 모듈과 테이블 공유, 아래 참고)
│   ├── safety/                 # 유저 차단/차단 해제/차단 목록
│   ├── upload/                 # 프로필 이미지 업로드 (S3)
│   ├── mission/                # 미션 목록/상세/저장/완료, AI 추천, LLM 헬스체크
│   ├── conversations/          # 대화 세션/메시지 (LLM 가이드 응답 포함)
│   ├── xp/                     # XP 요약/히스토리
│   ├── badge/                  # 뱃지 목록 조회 + 자동 획득 판정
│   ├── archive/                # 아카이브 요약/검색/폴더/문장/대화 기록 상세
│   ├── feedback/               # 대화 기반 AI 피드백 생성/재시도/상세 조회
│   ├── report/                 # 성장 리포트, 주간 비교 리포트, 리포트 저장/목록/상세
│   ├── home/                   # 홈 요약 조회
│   ├── payment/                # 플랜, 구독, 결제 (mock)
│   ├── notification/           # 알림 목록/읽음 처리 + 알림 설정 (setting 모듈과 테이블 공유)
│   ├── community/              # 미구현 (빈 스캐폴드)
│   ├── coaching/               # 미구현 (빈 스캐폴드)
│   └── health/                 # 헬스체크
├── shared/                # 공통 유틸리티
│   ├── errors/
│   ├── utils/
│   ├── constants/
│   └── llm/                # Upstage Solar 호출 공용 모듈
├── generated/             # tsoa가 생성하는 routes.ts (자동 생성, 수정 금지)
│   └── routes.ts
└── prisma/
    ├── schema.prisma
    ├── seed.ts
    └── migrations/
```

> 라우팅은 `*.routes.ts`를 수동 작성하지 않고, 컨트롤러에 `@Route`/`@Get`/`@Post` 등 tsoa 데코레이터를 붙여 빌드 시 `tsoa spec-and-routes`가 `generated/routes.ts`와 `swagger.json`을 자동 생성한다.
> 인증이 필요한 API는 `@Security("bearerAuth")`(Swagger 문서화용) + `@Middlewares(authorizeUser())`(실제 JWT 검증)를 함께 붙인다.
>
> **알림 설정 중복 구현 주의**: `PATCH/GET /users/me/settings`(setting 모듈)와 `PATCH/GET /notifications/settings`(notification 모듈)는 서로 다른 사람이 독립적으로 구현했지만, 실제로는 **같은 `Notification_Settings` 테이블을 그대로 읽고 쓰는 동일 기능**이다. 둘 중 하나로 통합할지, 의도적으로 유지할지는 아직 정리되지 않았다 — 이 중복을 인지하고 작업할 것.

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

> **마이그레이션 관례**: 이 프로젝트는 `npx prisma migrate dev`로 마이그레이션 파일을 남기는 것을 원칙으로 한다. 로컬 개발 중 `db push`로 스키마만 동기화하고 마이그레이션 파일 커밋을 누락하는 사고가 몇 차례 있었다(예: `#70`) — 스키마를 바꾸면 반드시 마이그레이션 파일도 같이 커밋한다.

## ERD (Entity Relationship Diagram)

> **source of truth는 [`prisma/schema.prisma`](../prisma/schema.prisma)다.** 컬럼/타입/제약조건/관계의 정확한 내용은 항상 스키마 파일을 직접 확인한다. 이 섹션은 도메인별 테이블 역할을 빠르게 훑기 위한 요약이며, 스키마가 바뀔 때마다 표를 다시 베끼지 않는다.

### 현재 구현 범위 (`prisma/schema.prisma`에 반영됨)

| 도메인 | 테이블 | 역할 |
|---|---|---|
| 인증 | `Users` | 서비스 사용자 본체 (name, status 등). 로그인 수단 정보는 갖지 않음 |
| 인증 | `Auth_Identities` | `Users` 1:N. 카카오/네이버/이메일 로그인 수단을 각각 한 행으로 저장 (email 방식만 `password_hash` 사용). 회원 탈퇴 시 `email`/`password_hash`가 익명화된다(`#79`, 아래 User APIs 참고) |
| 인증 | `Refresh_Tokens` | JWT Refresh Token, 기기정보, 폐기(revoked) 여부 |
| 인증 | `Terms` | 이용약관/개인정보처리방침 버전 관리 |
| 인증 | `Email_Verifications` | 이메일 인증 이력 (실제 인증번호/인증 상태는 Redis TTL로 관리, 이 테이블은 보조 이력용) |
| 인증 | `Login_History` | 로그인 이력 |
| 프로필/온보딩 | `User_Profiles` | 닉네임, 성향, 레벨/XP, 온보딩 진행 상태. 회원가입 시 `Users`와 함께 즉시 생성됨 |
| 프로필/온보딩 | `Goals` | 개인 목표/하루 대화 목표 |
| 안전 | `Blocked_Users` | 유저 차단 관계 |
| 미션 | `Missions` | 미션 (템플릿/유저용 모두 포함, `is_template`로 구분) |
| 미션 | `Mission_Prep_Items` | 미션별 준비 질문/시작 문장/팁 |
| 미션 | `Mission_Saves` | 미션 저장(북마크) |
| 미션 | `Mission_Records` | 미션 수행 결과, XP 지급 내역과 연결 |
| 미션 | `Recommendation_Logs` | AI 추천 미션 생성 로그 |
| 대화 | `Conversations` | 미션 기반 대화 세션 |
| 대화 | `Conversation_Messages` | 대화 메시지 |
| 성장 | `XP_History` | XP 지급/차감 내역 (레벨 시스템의 원장) |
| 피드백 | `Feedbacks` | AI 피드백 점수(친절함/주도성/공감/질문 연결성) + 지표별 상세(`metrics` Json) + `mission_summary`(Json) |
| 아카이브 | `Saved_Phrases` | 저장한 문장 |
| 아카이브 | `Archive_Items` | 아카이브에 노출되는 항목(conversation/phrase/report). 미션은 이 테이블에 저장되지 않고 `Mission_Records`/`Conversations`에서 직접 조회한다 |
| 아카이브 | `Archive_Folders` | 아카이브 폴더 |
| 리포트 | `Reports` | 성장/주간비교 리포트 스냅샷 저장 (`type`: `growth` \| `weekly_compare`) |
| 배지 | `Badges` | 배지 정의. `condition`(Json)에 자동 획득 판정 규칙 저장 |
| 배지 | `User_Badges` | 유저별 배지 획득 이력 |
| 알림 | `Notifications` | 인앱 알림 |
| 알림 | `Notification_Settings` | 알림 수신 설정 — `setting`/`notification` 두 모듈이 같은 테이블을 공유 (위 디렉토리 구조 섹션 참고) |
| 알림 | `Device_Tokens` | FCM 기기 토큰 (실제 푸시 발송 로직은 미구현) |
| 결제/구독 | `Plans` | 등급 정의 (free/premium). `POST /plans`는 없어 `prisma/seed.ts`로만 관리 |
| 결제/구독 | `Subscriptions` | 유저의 구독 상태. `status`(pending/active/expired/cancelled)와 `expires_at`으로 유효 여부를 그때그때 계산(lazy) — 별도 배치로 만료 처리하지 않음 |
| 결제/구독 | `Payments` | 결제 내역. 실제 PG 연동 없이 mock으로 즉시 `completed` 처리됨 |
| 사용량 | `Usage` | 롤링 1개월 주기의 AI 대화/피드백 사용량 |

### 아직 스키마에 없는 범위

커뮤니티/모임, 캘린더 관련 테이블은 API 명세서 기준으로는 확정됐지만 아직 `prisma/schema.prisma`에 반영되지 않았다. 해당 도메인 구현이 시작되면 스키마에 먼저 추가하고, 이 표도 같이 갱신한다.

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
| POST | /auth/password/reset-request | 비밀번호 재설정 인증코드 발송 |
| POST | /auth/password/reset | 비밀번호 재설정 |
| GET | /legal/terms | 이용약관 조회 |
| GET | /legal/privacy | 개인정보처리방침 조회 |

> 계정 삭제(`POST /users/me`, 실질적으로 회원 탈퇴)는 Auth 도메인이 아니라 User 도메인에 속한다 — `### User APIs` 참고.
>
> **소셜 로그인(Android 클라이언트) 인증 방식**: Kakao SDK / Naver SDK가 디바이스에서 로그인을 처리하고 **Provider Access Token**을 앱에 직접 발급한다. 백엔드는 Authorization Code → Token 교환을 수행하지 않고, **클라이언트가 전달한 Provider Access Token을 그대로 카카오/네이버의 사용자 정보 조회 API에 전달해 검증**한다. API 명세서 원안은 Authorization Code 방식(`code`/`state`)으로 작성되어 있으나, 팀 논의로 Provider Access Token 방식을 유지하기로 확정했다 — 명세서보다 실제 구현이 우선한다.
>
> **이메일 로그인**: `/auth/signup`(`/auth/register`)은 이메일 인증(`/auth/email/request` → `/auth/email/verify`) 완료 후 비밀번호와 이름, `termsAgreedAt`(ISO 8601 동의 시각)을 받아 계정을 생성한다. 비밀번호는 8자 이상 + 숫자 + 영문 + 특수문자 포함 규칙을 적용하고 bcrypt로 해시하여 저장한다. 이메일 중복 여부는 `/auth/email/request` 시점에 이미 체크한다. (생년월일/학교·직업은 어떤 가입 경로로도 수집·사용하지 않아 `Users` 스키마에서 제거했다.)
>
> **계정 연동**: 카카오/네이버 로그인 시, 같은 이메일로 다른 수단이 이미 가입되어 있으면 새 계정을 만들지 않고 응답에 `needsLinking: true`와 기존 계정 정보를 포함한다(토큰은 발급하지 않음). 실제로 두 계정을 병합하는 API는 아직 없다.
>
> **탈퇴한 계정으로 로그인 시도** (`#79`): 회원 탈퇴 시 `Auth_Identities.email`이 익명화되므로, **이메일 로그인**에서는 탈퇴 계정이 더 이상 이메일로 조회되지 않아 `404 NOT_FOUND`(존재하지 않는 이메일입니다)로 응답한다. 반면 **소셜 로그인**은 `provider`+`provider_user_id`로 조회하므로(익명화 대상 아님) 탈퇴 계정이면 여전히 `403 FORBIDDEN`(탈퇴한 계정입니다)을 정상적으로 반환한다 — 로그인 경로에 따라 탈퇴 계정 응답이 다르다는 점에 주의.

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

`needsLinking: true`인 경우 `accessToken`/`refreshToken`/`expiresIn`은 모두 `null`이다. 탈퇴한 계정으로 로그인 시도 시 `403 FORBIDDEN`.

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

탈퇴한 계정의 이메일은 위 note 참고 — `404 NOT_FOUND`로 응답한다(`403`이 아님).

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

#### POST /auth/password/reset-request

**Request Body:** `{ "email": "test@example.com" }`

가입된 이메일(email 수단)인지 확인 후 재설정 인증번호를 발급한다. `/auth/email/request`와 동일하게 Redis에 5분 TTL로 저장하고 메일을 발송하되, 회원가입 인증 코드와 섞이지 않도록 별도 키 네임스페이스(`password-reset:code:`)를 쓴다.

#### POST /auth/password/reset

**Request Body:** `{ "email": "test@example.com", "code": "483921", "newPassword": "NewPass1234!" }`

코드가 유효하면 비밀번호를 변경하고, 해당 계정으로 발급된 모든 Refresh Token을 폐기한다(재로그인 필요). 코드 불일치/만료는 `/auth/email/verify`와 동일하게 구분해서 에러를 반환한다.

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

### User APIs (프로필/온보딩/목표/탈퇴/사용량/마이페이지)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /users/me | 내 프로필 조회 |
| PATCH | /users/me | 내 프로필 수정 |
| POST | /users/me | 회원 탈퇴 (soft delete) |
| PATCH | /users/me/onboarding | 온보딩 단계별 저장 |
| POST | /users/me/onboarding/complete | 온보딩 완료 처리 |
| POST | /users/me/password/verify | 비밀번호 변경 전 현재 비밀번호 확인 |
| PATCH | /users/me/password | 비밀번호 변경 |
| GET | /users/me/usage | 사용량 조회 |
| GET | /users/me/dashboard | 마이페이지 요약 |
| GET | /goals | 목표 목록 조회 |
| POST | /goals | 목표 생성 |
| PATCH | /goals/{goalId} | 목표 수정 |
| DELETE | /goals/{goalId} | 목표 삭제 |

모두 `Authorization: Bearer {accessToken}` 필수. 설정(`/users/me/settings`)은 `### Notification & Settings APIs`, 유저 차단은 `### Safety APIs`, 프로필 이미지 업로드는 `### Upload APIs` 참고.

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

#### POST /users/me — 회원 탈퇴 (`#41`, `#79`)

**Response (200):** `{ "success": true, "message": "탈퇴가 완료되었습니다.", "data": null, "errorCode": null }`

`Users.status`를 `deleted`로 바꾸는 동시에(soft delete), 같은 유저의 모든 `Auth_Identities.email`을 `deleted_{userId}@withdrawn.local`로 익명화하고 `password_hash`도 제거한다(`#79`). `userId`는 가입마다 새로 발급되는 UUID라 같은 이메일로 몇 번을 반복 가입/탈퇴해도 익명화된 값끼리 충돌하지 않는다 — 탈퇴한 이메일은 즉시 재가입 가능. 미션 기록/XP 등 나머지 데이터는 삭제되지 않고 그대로 보존된다. 트레이드오프는 위 Auth APIs의 탈퇴 계정 로그인 note 참고.

#### POST /users/me/password/verify

**Header:** `Authorization: Bearer {accessToken}` 필수

**Request Body:** `{ "currentPassword": "string" }`

비밀번호 변경 화면이 "현재 비밀번호 확인 → 새 비밀번호 입력" 2단계로 구성되어 있어, 확인을 별도 API로 분리했다. 확인에 성공하면 Redis에 `password-change:verified:{userId}`를 10분 TTL로 저장하고, `PATCH /users/me/password`는 이 플래그가 있어야만 동작한다(없으면 403 `FORBIDDEN`) — 확인 단계를 건너뛰고 변경 API를 바로 호출하는 것을 막기 위함.

#### PATCH /users/me/password

**Header:** `Authorization: Bearer {accessToken}` 필수

**Request Body:** `{ "newPassword": "string" }`

직전에 `POST /users/me/password/verify`를 거쳐야 한다. 변경 성공 시 해당 계정의 모든 Refresh Token을 폐기한다(다른 기기 재로그인 필요).

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

#### GET /users/me/usage

**Query String:** 없음 — 항상 "현재 주기"의 사용량만 반환한다. 과거 주기 조회는 이번 범위에 없다.

**Response (200):** `data` — `cycleStart`, `cycleEnd`, `aiCount`, `feedbackCount`, `aiLimit`(`null`=무제한), `feedbackLimit`(`null`=무제한).

사용량은 달력 월(`YYYY-MM`)이 아니라 **롤링 1개월 주기**로 집계한다. 주기의 기준일(anchor)은:
- 유효한(active + 만료 전) 구독이 있으면 그 **구독의 `started_at`**
- 없으면(무료 등급) **회원가입일**(`Users.created_at`)

주기는 anchor로부터 매달 반복되며(`getCurrentCycleStart`, `shared/utils/date.ts`), `aiLimit`/`feedbackLimit`은 유저의 현재 유효 플랜(`payment` 모듈의 `getUsageContext` — 유효한 active 구독이 없으면 free 플랜)에서 가져온다. 해당 주기의 사용량 데이터(`Usage` 테이블, `cycle_start` 컬럼으로 식별)가 없으면 `aiCount`/`feedbackCount`는 0으로 응답한다.

> 구독을 시작/결제 완료하거나 만료되면 anchor가 바뀌어 사용량 주기 경계도 함께 바뀐다 (예: 가입일 기준으로 쓰다가 구독 결제를 완료하면 그 시점부터 구독 시작일 기준으로 재계산됨). **취소는 anchor를 바꾸지 않는다** — 취소해도 만료일 전까지는 여전히 프리미엄으로 취급되어(`isSubscriptionEffective`) 구독 시작일 기준 anchor와 한도가 그대로 유지되고, 실제 만료 시점이 지나야 비로소 가입일 기준(무료)으로 되돌아간다. 별도 배치 없이 조회 시점마다 anchor와 현재 시각으로 주기를 그때그때 계산한다(lazy).

#### GET /users/me/dashboard — 마이페이지 요약

**Response (200):** `data` —
```json
{
  "nickname": "string | null",
  "email": "string | null",
  "avatarUrl": "string | null",
  "level": 3,
  "xp": 450,
  "badges": [{ "id": "uuid", "name": "string", "iconUrl": "string | null" }],
  "weeklyMissionStatus": { "completed": 3, "total": 5 },
  "recentMissionSummary": [{ "id": "uuid", "title": "string", "result": "success", "completedAt": "ISODate | null" }]
}
```

`badges`는 획득한 배지만 `id`/`name`/`iconUrl`로 간략히 보여준다 — `GET /badges/me`(아래 Badge APIs)처럼 미획득 배지의 진행률(`progress`)까지 포함하지는 않는다.

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

### Notification & Settings APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /notifications | 알림 목록 조회 |
| PATCH | /notifications/{notificationId}/read | 알림 읽음 처리 |
| PATCH | /notifications/all/read | 알림 전체 읽음 처리 |
| GET | /notifications/settings | 알림 설정 조회 |
| PATCH | /notifications/settings | 알림 설정 수정 |
| GET | /users/me/settings | 설정 조회 (`/notifications/settings`와 동일 테이블) |
| PATCH | /users/me/settings | 설정 수정 (`/notifications/settings`와 동일 테이블) |

모두 `Authorization: Bearer {accessToken}` 필수.

> **중복 구현**: `/notifications/settings`와 `/users/me/settings`는 응답 필드(`missionReminder`, `communityApproved`, `reportReady`, `marketing`)와 저장 테이블(`Notification_Settings`)이 완전히 동일하다. 서로 다른 담당자가 독립적으로 만든 중복 기능으로 보인다 — 정리 필요(위 디렉토리 구조 섹션 note도 참고).
>
> **실제 푸시 발송은 미구현**: `Device_Tokens` 테이블과 설정 저장은 구현되어 있지만, 미션 완료/뱃지 획득 등 이벤트가 발생했을 때 실제로 `Notifications` row를 생성하거나 FCM 푸시를 보내는 트리거 로직은 아직 없다. 지금 구현된 건 "조회/설정/읽음 처리" CRUD뿐이다.

#### GET /notifications

**Query String:** `isRead`(boolean, 선택), `page`, `limit`(기본 20)

**Response (200):** `data.notifications[]` — `id`, `type`, `title`, `body`(`string | null`), `isRead`, `createdAt`.

#### PATCH /notifications/{notificationId}/read

본인 소유가 아니거나 존재하지 않으면 404 `NOT_FOUND`.

#### PATCH /notifications/all/read

본인의 모든 미읽음 알림을 읽음 처리한다.

#### GET /notifications/settings, GET /users/me/settings

**Response (200):** `data` — `{ missionReminder, communityApproved, reportReady, marketing }` (모두 boolean).

설정이 없는 유저는 404 `NOT_FOUND`.

#### PATCH /notifications/settings, PATCH /users/me/settings

**Request Body (모두 선택):** `{ "missionReminder": true, "communityApproved": false, "reportReady": true, "marketing": false }`

> `notifications/settings` 쪽은 요청 바디에 대한 zod 검증 스키마가 연결되어 있지 않다 — 잘못된 타입을 보내도 400 `VALIDATION_ERROR`가 나지 않을 수 있다. 실제 구현 상태이며, 명세 문제가 아니라 코드 개선이 필요한 부분이다.

### Safety APIs (유저 차단)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /safety/blocked-users | 차단 목록 조회 |
| POST | /safety/blocked-users | 유저 차단 |
| DELETE | /safety/blocked-users | 유저 차단 해제 |

모두 `Authorization: Bearer {accessToken}` 필수.

#### GET /safety/blocked-users

**Response (200):** `data.blockedUsers[]` — `id`, `blockedUserId`, `nickname`(`string | null`), `avatarUrl`(`string | null`), `createdAt`.

#### POST /safety/blocked-users, DELETE /safety/blocked-users

**Request Body:** `{ "blockedUserId": "uuid" }`

### Upload APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /uploads/profile-image | 프로필 이미지 업로드 |

**Header:** `Authorization: Bearer {accessToken}` 필수, `Content-Type: multipart/form-data`

`multer` 메모리 스토리지로 파일을 받아 S3에 직접 업로드하는 **서버 프록시 방식**이다(presigned URL 발급 방식이 아님). 필드명은 `image`.

**Response (200):** `{ "success": true, "message": "프로필 이미지가 업로드되었습니다.", "data": { "avatarUrl": "string" }, "errorCode": null }`

### Badge APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /badges/me | 보유 배지 목록 조회 (전체 + 진행률) |

**Header:** `Authorization: Bearer {accessToken}` 필수

**Response (200):** `data.badges[]` — 획득/미획득 **전체** 배지를 반환한다.
```json
{
  "id": "uuid",
  "name": "설레는 첫걸음",
  "description": "string | null",
  "iconUrl": "string | null",
  "isEarned": true,
  "earnedAt": "ISODate | null",
  "progress": { "current": 9, "target": 15 }
}
```
`isEarned: true`면 `progress`는 항상 `null`이다.

> **자동 획득 로직 (`#73`)**: `Badges.condition`(Json)에 저장된 판정 규칙(누적 완료 횟수, 카테고리 묶음 완료 횟수, 서로 다른 카테고리 완료 종수, N일 연속 완료 스트릭, 피드백 지표 달성 횟수, 전체 지표 달성 횟수, 피드백 누적 생성 횟수 — 총 7종)을 기준으로 자동 판정한다. 크론 없이 두 시점에 트리거된다:
> - `POST /missions/{missionId}/complete` 완료 트랜잭션 안 — 응답의 `newlyEarnedBadges`로 즉시 전달 (미션 기반 뱃지)
> - `POST /feedback` 생성 처리 직후 — 응답의 `newlyEarnedBadges`로 즉시 전달 (피드백 기반 뱃지). 단 `POST /feedback/{feedbackId}/retry`는 백그라운드(fire-and-forget) 처리라 이 경로로는 즉시 알림이 안 가고, 다음 `GET /badges/me` 조회 시점에 지연 판정된다.
> - `GET /badges/me` 조회 시점에도 매번 지연 판정을 수행해, 위 두 트리거를 놓친 것까지 여기서 채운다.
>
> 뱃지 조건 중 "먼저 건넨 인사"(특정 미션 유형 3회 완료)는 별도 "미션 유형" 필드 없이 기존 `Missions.category`(짧은 대화/일상 대화 묶음)로 판정한다(PM 확인 완료). `prisma/seed.ts`에 14종 정의가 시딩되어 있다.

### Mission APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /missions | 미션 목록 조회 (필터링: difficulty/category/saved, 페이지네이션) |
| GET | /missions/today | 오늘의 추천 미션 조회 (AI) |
| GET | /missions/llm-health | LLM(Upstage) 연결 상태 점검 (진단용) |
| GET | /missions/{missionId} | 미션 상세 조회 |
| GET | /missions/{missionId}/prep | 대화 시작 준비 문장 조회 |
| POST | /missions/{missionId}/save | 미션 저장(북마크) |
| DELETE | /missions/{missionId}/save | 미션 저장 취소 |
| POST | /missions/{missionId}/complete | 미션 완료 처리 (결과/메모/소요시간 기록, XP 지급, 뱃지 판정) |

모두 `Authorization: Bearer {accessToken}` 필수.

> `POST /missions/{missionId}/complete`는 (구 명세서의 `POST /conversations/{conversationId}/complete`가 아니라) **`missions` 리소스 아래**에 구현되어 있다 — 명세서 오탈자 주의.

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

#### GET /missions/today — AI 추천

`recommendation.service.ts`가 프로필 기반으로 미션을 추천한다. 4단계 폴백: LLM 생성 → 3단계 템플릿 선택 → 회피 카테고리 제외 하드 폴백. 온보딩 미완료 시 404 `MISSION_PROFILE_NOT_FOUND`.

**Response (200):** `data` — `missionId`(`string | null`, LLM/폴백 생성이라 아직 미저장이면 `null`), `title`, `category`, `difficulty`, `estimatedMinutes`, `rewardXp`, `description`, `reason`(추천 이유).

#### GET /missions/llm-health

운영 진단용. **Response (200):** `data` — `connected`(boolean), `model`, `sample?`(연결 성공 시 응답 일부), `reason?`(실패 사유: `no_api_key`/`http_xxx`/`timeout`/`network_error`).

#### GET /missions/{missionId}

**Response (200):** 목록 아이템 필드 + `description`, `preparationTip`(`string | null`), `caution`(`string | null`). 존재하지 않으면 404 `MISSION_NOT_FOUND`.

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

#### POST /missions/{missionId}/complete

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
    "completedAt": "ISODate",
    "newlyEarnedBadges": []
  },
  "errorCode": null
}
```

`newlyEarnedBadges`는 이번 완료로 새로 획득한 뱃지 배열이다(없으면 빈 배열) — `### Badge APIs` 참고. XP는 `success`일 때만 `Missions.reward_xp` 전액 지급, `failure`/`avoidance`는 0으로 처리한다(결과별 차등 지급 규칙은 기획 미확정).

### Conversation APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /conversations | 대화 세션 생성 |
| GET | /conversations/{conversationId} | 대화 내역 조회 |
| GET | /conversations/{conversationId}/guide | 주제 도움/추천 문장 조회 |
| POST | /conversations/{conversationId}/messages | 메시지 저장 + AI 응답 생성 |
| GET | /conversations/{conversationId}/suggestions | 후속 질문/표현 추천 조회 |
| POST | /conversations/{conversationId}/finish | 대화 종료 |

모두 `Authorization: Bearer {accessToken}` 필수. 미션 완료 처리는 `POST /missions/{missionId}/complete`(위 Mission APIs), 피드백 생성은 `POST /feedback`(아래 Feedback APIs)로 분리되어 있다.

> **AI 가이드 응답 (`#52`)**: `POST .../messages`는 Upstage Solar LLM을 실시간 호출해 가이드 응답을 생성한다(최근 대화 10건 + 유저 성향/스타일 반영). LLM 호출이 두 번 연속 실패하면 사전 정의된 템플릿 응답(`MOCK_GUIDE_RESPONSES`)으로 폴백한다 — 응답 스펙(필드 구성)은 동일하므로 클라이언트는 이 폴백을 구분할 필요가 없다. `주제 도움/추천 문장`, `후속 질문/표현 추천`은 LLM을 쓰지 않고 미션 준비 문장(`Mission_Prep_Items`) 기반 템플릿으로 동작한다.

#### POST /conversations

**Request Body:** `{ "missionId": "uuid", "mode": "text" | "voice", "selectedTopic": "string (선택)" }`

**Response (200):**
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

#### GET /conversations/{conversationId}/guide

**Response (200):** `data` — `conversationId`, `guideCards: string[]`, `suggestedReplies: string[]`.

#### POST /conversations/{conversationId}/messages

**Request Body:** `{ "role": "user", "content": "string" }` (내용 2자 이상 필수)

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

#### GET /conversations/{conversationId}/suggestions

**Response (200):** `data.suggestions: string[]`.

#### POST /conversations/{conversationId}/finish

**Request Body:** `{ "status": "completed" | "abandoned" }`

**Response (200):** `data` — `conversationId`, `status`, `finishedAt`.

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
> `nextLevelXp`는 미션 완료 시 레벨업 판정과 **반드시 같은 공식**이어야 한다(어긋나면 진행바가 꽉 찼는데 레벨업이 안 되는 현상이 생긴다). 공식은 `src/modules/xp/services/level.service.ts`의 `calculateNextLevelXp` 하나로 관리하며, 미션 완료 로직(`mission-completion.service.ts`)과 리포트의 레벨 역산 로직(`report/services/growth.service.ts`)도 이 함수를 import해서 쓴다. 현재 값은 `level * 100`이나 **기획 미확정 상태**이며, 변경 시 이 함수만 수정하면 전부에 함께 반영된다.

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
        "referenceId": "uuid | null",
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

### Archive APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /archives/summary | 아카이브 카운트/최근 활동 조회 |
| GET | /archives | 검색 및 필터 (페이지네이션) |
| GET | /archives/conversations/{conversationId} | 대화 기록 상세 조회 |
| GET | /archives/phrases/{phraseId} | 저장 문장 상세 조회 |
| POST | /archives/phrases | 문장 저장 |
| DELETE | /archives/phrases/{phraseId} | 저장 문장 삭제 |
| DELETE | /archives/items/{itemId} | 아카이브 항목 삭제 |
| GET | /archives/folders | 폴더 목록 조회 |
| POST | /archives/folders | 새 폴더 생성 |
| PATCH | /archives/folders/{folderId} | 폴더명 수정 |
| POST | /archives/folders/{folderId}/items | 항목 폴더 저장 |

모두 `Authorization: Bearer {accessToken}` 필수. (구 명세서의 `GET /archives/search`, `/archive-folders`는 실제로는 각각 `GET /archives`, `/archives/folders`로 구현되어 있다.)

> **미션은 `Archive_Items`에 저장되지 않는다.** conversation/phrase/report 세 타입만 `Archive_Items`에 저장되고, 미션(`type: "mission"`)은 `Mission_Records`(완료)/`Conversations`(진행 중)에서 직접 조회해 합쳐서 보여준다. 응답의 `id`는 타입에 따라 의미가 달라 `missionId`/`conversationId`/`missionRecordId`를 별도 필드로도 함께 내려준다(`#66`~`#74`에 걸쳐 여러 차례 수정됨).

#### GET /archives/summary

**Response (200):** `data` — `totalCount`, `missionRecordCount`, `conversationCount`, `phraseCount`, `reportCount`, `recentItems[]`(최근 10건).

`recentItems[]` 필드: `id`, `type`(`conversation`\|`phrase`\|`report`\|`mission`), `title`, `isBookmarked`, `missionId`(`string | null`), `conversationId`(`string | null`), `missionRecordId`(`string | null`), `missionStatus?`(`in_progress`\|`completed`, mission 타입만), `category?`, `difficulty?`, `estimatedMinutes?`, `rewardXp?`(마지막 4개는 mission 타입만), `createdAt`.

#### GET /archives — 검색 및 필터

**Query String:** `keyword`, `type`(`conversation`\|`phrase`\|`report`\|`mission`), `startDate`, `endDate`(YYYY-MM-DD), `sort`(`latest`\|`oldest`\|`saved`), `folderId`, `tag`, `page`, `size`.

`type`을 안 주면 conversation/phrase/report + mission을 합쳐서 반환한다. `sort=saved`는 mission 타입에서만 유효(저장한 순).

**Response (200):** `data` — `totalCount`, `items[]`, `pageInfo`. `items[]` 필드는 `archiveItemId`(`string | null`, mission은 null), `referenceId`, `id`, `type`, `title`, `tags[]`, `folderId`(`string | null`), `isBookmarked`, `missionStatus?`, `category?`, `difficulty?`, `estimatedMinutes?`, `rewardXp?`, `missionId`(`string | null`), `missionRecordId`(`string | null`), `createdAt`.

#### GET /archives/conversations/{conversationId}

**Response (200):** `data` — `conversationId`, `missionTitle`(`string | null`), `summary`(현재 항상 빈 문자열 — AI 요약 파이프라인 미구현), `messages[]`(`sender: "USER"|"AI"`, `content`, `sentAt`), `feedback`(`{feedbackId, kindnessScore, initiativeScore, empathyScore, questionLinkScore} | null`).

#### GET /archives/phrases/{phraseId}

**Response (200):** `data` — `id`, `content`, `memo`(`string | null`), `missionTitle`(`string | null`), `conversationId`(`string | null`), `folderId`(`string | null`), `createdAt`.

#### POST /archives/phrases

**Request Body:** `{ "conversationId": "uuid", "content": "string", "memo": "string (선택)" }`

**Response (200):** `data` — `id`, `conversationId`, `content`, `memo`, `createdAt`.

#### DELETE /archives/items/{itemId}

`Archive_Items` row를 삭제한다(미션 아이템은 이 경로로 삭제되지 않음).

#### GET /archives/folders, POST /archives/folders, PATCH /archives/folders/{folderId}

**Response (200) 공통:** `data` — `id`, `name`(목록 조회는 `itemCount` 포함).

#### POST /archives/folders/{folderId}/items

**Request Body:** `{ "itemId": "uuid" }`

**Response (200):** `data` — `folderId`, `itemId`.

### Feedback APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /feedback | 대화 기반 피드백 생성 |
| POST | /feedback/{feedbackId}/retry | 피드백 재시도 |
| GET | /feedback/{feedbackId} | 피드백 상세 조회 |

모두 `Authorization: Bearer {accessToken}` 필수.

> **LLM 연동 (`#53`)**: Upstage Solar를 호출해 4개 지표(kindness/initiative/empathy/questionLink)를 채점한다. 실패해도 가짜 점수로 대체하지 않고 `status: "failed"`로 남긴다 — 재시도는 `POST /feedback/{feedbackId}/retry`. 대화당 피드백 1건 원칙(find-or-create)이라 이미 `ready`면 재생성 없이 그대로 반환(멱등)한다.

#### POST /feedback

**Request Body:** `{ "conversationId": "uuid" }`

**Response (200):**
```json
{
  "success": true,
  "data": {
    "feedbackId": "uuid",
    "conversationId": "uuid",
    "topic": "string | null",
    "overallScore": 86,
    "metrics": [
      { "key": "kindness", "label": "친절한 태도", "score": 92, "strengths": ["string"], "improvements": ["string"], "bestSentence": "string | null" }
    ],
    "missionSummary": ["string"],
    "savedPhrase": "string | null",
    "status": "ready",
    "newlyEarnedBadges": []
  },
  "message": null
}
```

`metrics`는 항상 kindness/initiative/empathy/questionLink 4개 고정 순서. `newlyEarnedBadges`는 이번 생성 처리(성공/실패 무관) 직후 즉시 판정된 결과다 — `status`가 `failed`여도 피드백 row 자체는 생성된 것으로 카운트되므로("피드백 수집가" 같은 누적 생성 조건) 빈 배열이 아닐 수 있다. 사용자 발화가 2건 미만이거나 총 글자 수가 너무 짧으면 400 `FEEDBACK_INPUT_TOO_SHORT`.

#### POST /feedback/{feedbackId}/retry

**Response (200):** `{ "success": true, "message": "피드백을 다시 생성하고 있습니다.", "data": { "feedbackId": "uuid", "status": "pending" }, "errorCode": null }`

응답은 즉시 `pending`으로 오고, 실제 재생성은 백그라운드(fire-and-forget)에서 진행된다 — 결과 확인은 `GET /feedback/{feedbackId}`로 폴링. 이 경로로 새로 채워진 조건은 `newlyEarnedBadges`로 즉시 전달되지 않고, 다음 `GET /badges/me` 조회 시점에 반영된다.

#### GET /feedback/{feedbackId}

**Response (200):** `data` — `id`, `conversationId`, `topic`, `overallScore`, `metrics[]`, `missionSummary[]`, `savedPhrase`, `status`, `createdAt`. (여기엔 `newlyEarnedBadges`가 없다 — 생성/재시도 응답에만 있는 필드.)

### Report APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /reports/growth | 성장 리포트 조회 (라이브 계산) |
| GET | /reports/weekly-compare | 주간 비교 리포트 조회 (라이브 계산) |
| POST | /reports | 리포트 저장 (스냅샷) |
| GET | /reports | 리포트 목록 조회 |
| GET | /reports/{reportId} | 리포트 상세 조회 |
| DELETE | /reports/{reportId} | 리포트 저장 해제 (`#85`) |

모두 `Authorization: Bearer {accessToken}` 필수.

> `growth`/`weekly-compare` 두 GET은 별도 배치 없이 조회 시점에 `Feedbacks`/`Mission_Records`/`XP_History`를 집계해서 계산한다(lazy). 계산 기준 주는 **호출 시각 기준 rolling이 아니라 달력 주(월요일 시작)**로 고정되어 있어(`report/services/week-window.ts`), 같은 주 안에서는 몇 번을 호출해도 활동이 안 늘면 값이 그대로 유지된다. 이 결과를 그대로 얼려서 보관하고 싶으면 `POST /reports`로 저장한다. `Reports.type`은 `growth` \| `weekly_compare` 두 값만 쓴다(과거 `monthly`/`weekly` enum은 폐기됨).

#### GET /reports/growth

**Response (200):** `data` — `levelBefore`, `levelAfter`(XP_History를 시간순 재생해 4주 전 레벨을 역산), `weeklyTrend[]`(`{week, score}`, 4주), `trendChangeRate`, `topCategories[]`(`{category, count}`, 상위 3), `missionProgress`(`{completed, total}` — "톡깨 미션" 전체 기준, 특별 미션 개념 아님).

#### GET /reports/weekly-compare

**Response (200):** `data` — `thisWeek`/`lastWeek`(`{completedMissionCount, xpEarned, metrics}`), `xpChangeRate`, `overallScoreChange`(`{from, to, delta}`), `metricChanges[]`(`{key, label, from, to, delta}`), `highlights[]`(자동 생성 문구, 최대 3개).

#### POST /reports

**Request Body:** `{ "type": "growth" | "weekly_compare" }`

**Response (200):** `data` — `reportId`, `type`, `period`(growth: `YYYY-MM-DD~YYYY-MM-DD`, weekly_compare: `YYYY-Www`), `createdAt`.

저장 시 위 두 GET이 그 순간 반환하는 라이브 데이터를 그대로 스냅샷으로 얼려 저장하고, 동시에 아카이브에도 노출되도록 `Archive_Items`(`type: "report"`)를 함께 생성한다. `type`이 `growth`/`weekly_compare`가 아니면 400 `VALIDATION_ERROR`.

#### GET /reports

**Query String:** `type`(선택)

**Response (200):** `data.reports[]` — `id`, `type`, `period`, `title`(대표 미션 주제, 없으면 "톡깨 리포트"), `createdAt`.

#### GET /reports/{reportId}

**Response (200):** `data` — `id`, `type`, `period`, `growth`(`type`이 growth일 때만 값, 아니면 `null`), `weeklyCompare`(`type`이 weekly_compare일 때만 값, 아니면 `null`), `createdAt`. discriminated union이라 `type`을 보고 어느 필드를 렌더링할지 분기한다. 존재하지 않으면 404 `NOT_FOUND`.

#### DELETE /reports/{reportId} — 리포트 저장 해제 (`#85`)

**Response (200):** `{ "success": true, "message": "리포트 저장이 해제되었습니다.", "data": { "reportId": "uuid", "deleted": true }, "errorCode": null }`

본인 소유가 아니거나 존재하지 않으면 404 `NOT_FOUND`. `POST /reports`가 저장 시 함께 만든 `Archive_Items`(`type: "report"`) row도 트랜잭션으로 같이 삭제한다(둘 다 없으면 정상 진행, 매핑 누락에 대해 방어적으로 처리).

### Home APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /home/summary | 홈 요약 조회 |

**Header:** `Authorization: Bearer {accessToken}` 필수

**Response (200):** `data` — `nickname`(`string | null`), `level`, `currentXp`, `nextLevelXp`, `todayMission`(`TodayMissionDto | null` — `{id, title, category, difficulty(number), estimatedMinutes, rewardXp, isCompleted, isSaved}`), `archiveCount`, `communityCount`, `questionOfDay`.

### Payment & Subscription APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /plans | 플랜 목록 조회 |
| POST | /subscriptions | 구독 시작 |
| GET | /subscriptions/me | 내 구독 정보 조회 |
| DELETE | /subscriptions/me | 구독 취소 |
| POST | /payments | 결제 요청 |
| GET | /payments/me | 결제 내역 조회 |

> 사업자등록증이 없어 실제 PG(결제대행사) 연동이 불가능하다. `POST /payments`는 클라이언트가 보낸 결제 정보를 검증 없이 그대로 신뢰하고 즉시 `completed`로 기록하는 **mock 구현**이다. `POST /subscriptions`와 `POST /payments`는 명세서상 별도 리소스로 분리되어 있어 그대로 두 개의 엔드포인트로 구현했고, **결제가 성공해야 구독이 활성화**된다 — `POST /subscriptions`는 `pending`(결제 대기) 상태로만 구독을 만들고, 그 구독을 참조하는 `POST /payments`가 성공해야 비로소 `active`로 전환된다. `Subscriptions.status`에 `pending`을 추가했다(원래 ERD엔 active/expired/cancelled만 있었음).
>
> 이전 초안에 있던 `POST /payments/webhook`(PG사 Webhook 수신)은 현재 API 명세서에는 없다. 실제 PG사 연동 시 필요 여부를 다시 확인한다.
> **결제**: Android 인앱결제(Google Play Billing) 정책상 디지털 재화(구독)는 Play Billing 연동이 필요할 수 있으므로, PG사 직결제 도입 전 Google Play 정책 검토가 필요하다 (미구현).

#### GET /plans

**Header:** `Authorization` 불필요

**Response (200):** `data.plans[]` — `id`, `name`(free/premium), `price`, `currency`, `aiLimit`/`feedbackLimit`(`null`=무제한), `features[]`. `prisma/seed.ts`로 시딩된 데이터를 그대로 반환한다.

#### POST /subscriptions

**Header:** `Authorization: Bearer {accessToken}` 필수

**Request Body:** `{ "planId": "string" }`

`pending` 또는 유효한(만료되지 않은) `active` 구독이 이미 있으면 409 `DUPLICATED`. 존재하지 않거나 비활성 플랜이면 400 `VALIDATION_ERROR`. 응답의 `status`는 `pending`이고 `expiresAt`은 `null`이다 — 아직 프리미엄이 아니며, `POST /payments`로 결제를 완료해야 `active`로 전환되고 그 시점부터 1개월짜리 `expiresAt`이 계산된다.

#### GET /subscriptions/me

**Header:** `Authorization: Bearer {accessToken}` 필수

가장 최근 구독을 조회해, `status`가 `pending`/`expired`이거나 `expires_at`이 지났으면(lazy 판정) 404 `NOT_FOUND`("활성화된 구독이 없습니다.")를 반환한다. 결제 전(`pending`) 구독은 아직 프리미엄이 아니므로 여기서 보이지 않는다. `status: cancelled`인데 아직 만료 전이면 정상 응답한다 — 취소해도 이미 결제한 기간까지는 조회/이용이 가능하다는 의미다.

#### DELETE /subscriptions/me

**Header:** `Authorization: Bearer {accessToken}` 필수

현재 `active`이고 만료 전인 구독만 취소 가능(그 외엔 404). `expires_at`은 변경하지 않고 `status`만 `cancelled`로 바꾼다 — 다음 갱신 시점(만료일)에 자연스럽게 무료로 내려간다(배치 없이 `GET /subscriptions/me` 등 조회 시점마다 lazy 판정).

#### POST /payments

**Header:** `Authorization: Bearer {accessToken}` 필수

**Request Body:** `{ "subscriptionId": "string", "amount": 9900, "currency": "KRW", "method": "card", "externalId": "string" }`

`subscriptionId`가 본인 소유 구독이 아니거나 이미 `pending`이 아닌(이미 결제 완료/취소/만료된) 구독이면 400 `VALIDATION_ERROR`. 성공 시 결제 기록을 남기고, 해당 구독을 `active`로 전환한다(`started_at`을 결제 성공 시각으로, `expires_at`을 그로부터 1개월 후로 설정). PG 연동이 없어 402 `PAYMENT_FAILED`는 명세서 형태만 정의해두었고 현재 코드에서 실제로 도달하는 경로는 없다.

#### GET /payments/me

**Header:** `Authorization: Bearer {accessToken}` 필수

본인의 결제 내역을 최신순으로 반환한다.

### Community APIs (미구현)

API 명세서에는 정의되어 있으나 아직 스키마/코드 모두 구현되지 않았다(`src/modules/community/`는 빈 스캐폴드). 상세 요청/응답 형식은 담당자가 구현 시점에 각 Notion 문서를 참고해 작성한다.

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

> `src/modules/coaching/`도 커뮤니티와 마찬가지로 빈 스캐폴드다 — 실제 계획된 기능인지, 예전에 만들어두고 방치된 것인지 확인이 필요하다.

## Error Codes

에러 코드는 **SCREAMING_SNAKE_CASE 문자열**을 사용한다. 접두사 규칙은 없으며, 코드 이름 자체가 곧 문서다. 같은 도메인 안에서도 에러 종류별로 별도 클래스(`*.error.ts`)를 만들고, 공통 `AppError`를 상속해 `errorCode`/`statusCode`/`message`/`data`를 갖도록 한다.

**공통 에러 코드**

| Code | HTTP Status | Description |
|------|-------------|-------------|
| VALIDATION_ERROR | 400 | 요청 데이터 유효성 검증 실패 |
| UNAUTHORIZED | 401 | Access Token 누락/만료/무효, 위변조/revoked된 Refresh Token |
| FORBIDDEN | 403 | 권한 없음 / 탈퇴한 계정(소셜 로그인만 해당, 위 Auth APIs note 참고) |
| NOT_FOUND | 404 | 리소스를 찾을 수 없음 |
| DUPLICATED | 409 | 리소스 중복 (일반, 이메일 중복 포함) |
| EXPIRED | 410 | 인증번호/토큰 등이 만료됨 |
| SERVER_ERROR | 500 | 서버 내부 오류 |

**도메인별 세부 코드**

| Code | HTTP Status | Description |
|------|-------------|-------------|
| UNVERIFIED_EMAIL | 422 | 이메일 인증이 완료되지 않음 (회원가입 시) |
| INVALID_PASSWORD | 400 | 이메일 로그인 비밀번호 불일치 |
| MISSION_NOT_FOUND | 404 | 존재하지 않는 미션/완료 처리 대상 |
| MISSION_PROFILE_NOT_FOUND | 404 | 온보딩 미완료로 미션 추천 불가 |
| CONVERSATION_NOT_FOUND | 404 | 존재하지 않는 대화 |
| FEEDBACK_NOT_FOUND | 404 | 존재하지 않는 피드백 |
| FEEDBACK_INPUT_TOO_SHORT | 400 | 대화 내용이 너무 짧아 피드백 생성 불가 |
| FEEDBACK_NOT_READY | 409 | 피드백이 아직 생성/재생성 중 |
| INSUFFICIENT_TOKENS | 402 | 토큰 잔여량 부족 (토큰/AI 코칭 도메인, 미구현) |
| COMMUNITY_FULL | 409 | 모임 정원 초과 (커뮤니티 도메인, 미구현) |
| PAYMENT_FAILED | 402 | 결제 처리 실패 (mock 구현이라 현재 코드에서 실제 도달 경로 없음) |
| AI_SERVICE_UNAVAILABLE | 503 | AI 응답 생성 실패 (대화/피드백 도메인, 재시도 후에도 실패) |

> 도메인별 세부 코드는 필요할 때마다 위 표에 추가한다. 이름은 다른 도메인 코드와 겹치지 않게, 의미가 분명하도록 짓는다. 각 도메인 담당자가 구현 시점에 실제 사용하는 코드로 갱신한다.

## Non-Functional Considerations

- **인증 흐름**: Android Kakao/Naver SDK가 발급한 Provider Access Token을 그대로 검증하므로, 백엔드는 Redirect URI 기반 Authorization Code 교환 로직을 구현하지 않는다 (API 명세서 원안과 다르게 유지하기로 확정한 부분, `### Auth APIs` 참고).
- **이메일 발송**: Resend를 사용하며, API 키가 없는 로컬 개발 환경에서는 인증번호를 서버 로그로만 출력한다. Resend 미인증 도메인 상태에서는 계정 소유자 이메일로만 실제 발송이 가능하다.
- **인증 상태 저장**: 이메일 인증번호/인증완료 상태는 DB 테이블이 아니라 Redis에 TTL로 저장한다 (인증번호 5분, 인증완료 후 회원가입 유예 30분).
- **LLM**: Upstage Solar를 미션 추천/대화 가이드 응답/AI 피드백 생성 세 군데서 호출한다(`shared/llm/upstage.ts` 공용). 실패 시 재시도 1회 후, 실패가 지속되면 도메인별로 다르게 처리한다 — 미션 추천은 템플릿/하드 폴백, 대화 가이드는 Mock 템플릿 폴백, 피드백은 폴백 없이 `status: failed`로 남기고 재시도 API로 유도(허위 분석 방지).
- **푸시**: APNs는 대상에서 제외하고 FCM(Android)만 지원 예정이나, 실제 발송 트리거 로직은 아직 미구현이다 (`### Notification & Settings APIs` note 참고).
- **결제**: Android 인앱결제(Google Play Billing) 정책상 디지털 재화(구독)는 Play Billing 연동이 필요할 수 있으므로, PG사 직결제 도입 전 Google Play 정책 검토가 필요하다 (미구현).
- **실시간 채팅**: Socket.IO 클라이언트는 Android 전용으로 단일 플랫폼 기준 룸 관리(`community:{id}`)만 고려한다 (미구현, 커뮤니티 도메인과 함께 구현 예정).
- **요청 추적**: 모든 요청에 `X-Request-Id` 헤더를 부여하고 응답에 동일 값을 포함한다.
- **마이그레이션 관례**: `Database` 섹션 참고 — 스키마 변경 시 `db push` 대신 `prisma migrate dev`로 마이그레이션 파일을 남기고 커밋한다.
