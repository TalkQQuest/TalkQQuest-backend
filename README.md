# TalkQuest Backend

TalkQuest Node.js + Express + TypeScript 백엔드입니다.
컨벤션/구조 결정 배경은 [docs/CONVENTION.md](docs/CONVENTION.md), [docs/design.md](docs/design.md), [docs/requirements.md](docs/requirements.md)를 참고하세요.
초기 세팅(레이어 구조, tsoa, Zod, 로깅 등)을 왜 이렇게 했는지는 [docs/SETUP_NOTES.md](docs/SETUP_NOTES.md)에 정리해두었습니다.

## 기술 스택

- Node.js 20 LTS / Express / TypeScript
- Prisma (MySQL 8.0)
- Redis (세션/캐시)
- tsoa (라우팅 + Swagger/OpenAPI 자동 생성)
- Zod (요청 검증)
- Jest + Supertest (테스트)

## 시작하기

```bash
npm install
cp .env.example .env   # 값 채워넣기 (DATABASE_URL, REDIS_URL, JWT 시크릿 등)
```

### 1. Prisma 클라이언트 생성

```bash
npm run prisma:generate
```

DB가 준비되면 마이그레이션을 실행합니다 (아직 DB가 없다면 스킵 가능):

```bash
npm run prisma:migrate
```

### 2. tsoa 라우트/Swagger 생성

`src/generated/routes.ts`와 `dist/swagger.json`은 자동 생성 파일이라 커밋하지 않습니다. 최초 1회 또는 컨트롤러 변경 시 실행하세요.

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
npm test
```

## 디렉토리 구조

[docs/CONVENTION.md](docs/CONVENTION.md) `## 2. 프로젝트 구조`에 정의된 구조를 그대로 따릅니다.

```
src/
├── app.ts / server.ts
├── config/            # env, database(Prisma), redis
├── middlewares/        # requestId, validator(Zod), auth(JWT), errorHandler
├── modules/             # 도메인별 controller → service → repository → dto → error
│   ├── auth/ onboarding/ mission/ coaching/ community/ payment/ report/ notification/
│   └── health/          # 헬스체크 (구조 검증용 샘플 모듈)
├── shared/              # AppError, 공통 응답 포맷, 에러 코드 상수
└── generated/           # tsoa 자동 생성 (routes.ts) — gitignore
```

도메인 모듈 폴더(`controllers/services/repositories/dtos/errors`)는 아직 기능이 확정되지 않아 `.gitkeep`만 있는 빈 폴더 상태입니다. `health` 모듈만 구조 검증용으로 컨트롤러를 채워뒀습니다.

## 공통 응답 / 에러 포맷

모든 API는 `{ success, data, error }` 형식으로 응답합니다 (`src/shared/utils/response.ts`).
에러 코드는 도메인 접두사 + 번호 스킴을 사용합니다 (`src/shared/constants/error-codes.ts`, [docs/CONVENTION.md](docs/CONVENTION.md) `## 3.8` 참고).

## 아직 결정되지 않은 것

- 실제 GitHub repository 연결 (현재는 로컬 폴더만 존재, git init도 하지 않은 상태)
- DB 접속 정보 (MySQL 로컬/원격 여부)
- Kakao/Naver OAuth, FCM 연동 키 값
