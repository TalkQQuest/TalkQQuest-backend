# TalkQuest Backend

톡깨(TalkQQuest) - AI가 추천하는 현실 대화 미션을 수행하고, 기록과 성장 리포트로 사회적 자신감의 변화를 확인하는 서비스의 백엔드 API 서버입니다.

컨벤션/구조 결정 배경은 [docs/CONVENTION.md](docs/CONVENTION.md), API 상세 명세는 [docs/design.md](docs/design.md), 요구사항은 [docs/requirements.md](docs/requirements.md)를 참고하세요. 초기 세팅(레이어 구조, tsoa, Zod, 로깅 등)을 왜 이렇게 했는지는 [docs/SETUP_NOTES.md](docs/SETUP_NOTES.md)에 정리되어 있습니다.

---

## 팀원 소개 및 역할 분담

| 네온/최희수 | 션/김서연 | 영/최유경 | 웬디/양다원 |
|:---:|:---:|:---:|:---:|
| <img width="120px" src="https://github.com/jajagyu.png" /> | <img width="120px" src="https://github.com/superbobstar7.png" /> | <img width="120px" src="https://github.com/cccyyy333.png" /> | <img width="120px" src="https://github.com/Dawon-Y.png" /> |
| [@jajagyu](https://github.com/jajagyu) | [@superbobstar7](https://github.com/superbobstar7) | [@cccyyy333](https://github.com/cccyyy333) | [@Dawon-Y](https://github.com/Dawon-Y) |

| 담당 | 팀원 (별명/실명) | 담당 도메인 |
| --- | --- | --- |
| A | 네온/최희수 | 인증(Auth), 결제/구독(Payment/Subscription), 뱃지(Badge), 리포트(Report, 공동) |
| B | 션/김서연 | 아카이브(Archive), 미션(Mission) |
| C | 영/최유경 | 유저(User, 온보딩 포함), 피드백(Feedback), XP, 리포트(Report, 공동), **AI/LLM 연동 전반**(대화 가이드 응답, 피드백 채점, 미션 추천·난이도) |
| D | 웬디/양다원 | 대화(Conversations), 알림(Notification), 홈(Home), 안전/설정(Safety/Setting), 업로드(Upload) |

> 작업 시작 전 자기 담당 도메인의 API 명세는 [docs/design.md](docs/design.md)에서 확인하세요.

---

## 기술 스택

| 구분 | 내용 |
| --- | --- |
| 언어 | TypeScript |
| 런타임 | Node.js 20 LTS |
| 프레임워크 | Express |
| ORM / DB | Prisma / MySQL 8.0 |
| 캐시 / 세션 | Redis |
| 라우팅 / 문서화 | tsoa (Swagger/OpenAPI 자동 생성) |
| 검증 | Zod |
| 인증 | JWT, Kakao/Naver OAuth2.0 |
| 파일 업로드 | Multer + AWS S3 |
| 테스트 | Jest + Supertest |

---

## 프로젝트 구조

```
src/
├── app.ts / server.ts
├── config/               # env, database(Prisma), redis
├── middlewares/          # requestId, validator(Zod), auth(JWT), errorHandler
├── modules/              # 도메인별 controller → service → repository → dto → error
│   ├── auth/               # 로그인, 회원가입, OAuth
│   ├── user/               # 유저 정보, 탈퇴
│   ├── onboarding/         # 온보딩 단계별 저장/완료 (URL은 /users/me/onboarding 하위 유지)
│   ├── mission/            # 미션 목록/상세/추천
│   ├── conversations/      # AI 대화 진행
│   ├── feedback/           # 대화 피드백(LLM 채점)
│   ├── badge/              # 뱃지 자동 판정
│   ├── report/             # 성장/주간 비교 리포트
│   ├── archive/            # 보관함(대화/문장/리포트/미션 북마크)
│   ├── xp/                 # XP/레벨
│   ├── home/               # 홈 요약
│   ├── notification/       # 알림
│   ├── safety/             # 안전 신고 등
│   ├── setting/            # 설정
│   ├── upload/             # 프로필 이미지 업로드(S3)
│   ├── payment/            # 결제/구독
│   ├── coaching/           # 스캐폴드만 존재, 미구현
│   ├── community/          # 스캐폴드만 존재, 미구현
│   └── health/             # 헬스체크
├── shared/               # AppError, 공통 응답 포맷, 에러 코드 상수, LLM/유틸
└── generated/            # tsoa 자동 생성 (routes.ts) — gitignore
```

세부 규칙(브랜치/커밋/PR/네이밍)은 [docs/CONVENTION.md](docs/CONVENTION.md)를 따릅니다.

---

## 시작 가이드

```bash
npm install
cp .env.example .env   # 값 채워넣기
```

필요한 환경변수:

| 키 | 설명 |
| --- | --- |
| `DATABASE_URL` | MySQL 접속 정보 |
| `REDIS_URL` | Redis 접속 정보 |
| `JWT_SECRET` 등 | 액세스/리프레시 토큰 시크릿 |
| `KAKAO_*` / `NAVER_*` | 소셜 로그인 OAuth 키 |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` / `S3_BUCKET_NAME` | 프로필 이미지 업로드(S3) |
| `UPSTAGE_API_KEY` | 피드백 LLM 채점(Upstage Solar) |

### 1. Prisma 클라이언트 생성

```bash
npm run prisma:generate
```

DB가 준비되면 마이그레이션을 실행합니다:

```bash
npm run prisma:migrate
```

### 2. tsoa 라우트/Swagger 생성

`src/generated/routes.ts`와 `dist/swagger.json`은 자동 생성 파일이라 커밋하지 않습니다. 최초 1회 또는 컨트롤러 변경 시 실행하세요 (`npm run dev`는 자동으로 실행합니다).

```bash
npm run tsoa:gen
```

### 3. 개발 서버 실행

```bash
npm run dev
```

- API Base URL: `http://localhost:3000/api/v1`
- Swagger UI: `http://localhost:3000/docs`
- Health check: `GET /api/v1/health`

### 4. 테스트

```bash
npm test              # 유닛 테스트 (리포지토리 계층을 목킹, DB/Redis 불필요)
npm run test:integration   # 통합 테스트 (실제 MySQL 필요, *.integration.test.ts)
```

동시성 처리처럼 실제 DB 락/유니크 제약이 걸려야 검증되는 로직은 통합 테스트로 작성합니다. 목킹만으로는 이런 경우를 재현할 수 없습니다.

**통합 테스트는 개발 DB와 분리된 전용 DB가 필요합니다** — 실제로 행을 생성·삭제하므로 개발 데이터와 섞이면 안 됩니다.

```bash
# 1. 테스트 전용 DB 생성 (개발 DB와 이름이 달라야 함)
mysql -u root -p -e "CREATE DATABASE talkquest_test;"

# 2. .env.test 준비
cp .env.test.example .env.test   # 필요하면 DATABASE_URL 등 값 수정

# 3. 테스트 DB에 스키마 반영
DATABASE_URL="mysql://root:password@localhost:3306/talkquest_test" npx prisma migrate deploy

# 4. 통합 테스트 실행
npm run test:integration
```

`DATABASE_URL`에 `test`라는 단어가 없으면 안전장치가 실행 자체를 막습니다(`jest.integration.setup.js`).

---

## API 문서

전체 API 명세는 [docs/design.md](docs/design.md)에서 확인하세요. 도메인별 요청/응답 형식, 알려진 이슈(구현 안 된 기능, 알려진 버그 등)까지 정리되어 있습니다.

## 공통 응답 / 에러 포맷

모든 API는 `{ success, message, data, errorCode }` 형식으로 응답합니다 (`src/shared/utils/response.ts`).
에러 코드는 `VALIDATION_ERROR`, `UNAUTHORIZED`처럼 SCREAMING_SNAKE_CASE 문자열 상수를 사용합니다 (`src/shared/constants/error-codes.ts`, [docs/CONVENTION.md](docs/CONVENTION.md) `## 3.8` 참고).

---

## 배포

`main` 브랜치에 push되면 GitHub Actions(`.github/workflows/deploy.yml`)가 테스트 통과 후 EC2에 자동 배포합니다 (`git pull` → `npm ci` → `prisma generate` → `build` → `pm2 restart`).

> DB 스키마 마이그레이션(`prisma migrate deploy`/`db push`)과 시드는 자동 배포에 포함되지 않으며, 스키마 변경 시 별도로 EC2에 SSH 접속해 수동으로 실행해야 합니다.
