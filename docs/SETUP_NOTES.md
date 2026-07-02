# 초기 세팅 결정 노트

이 문서는 TalkQuest 백엔드의 **기능 구현 전에 깔아둔 기본 구조/도구를 왜 이렇게 정했는지** 기록합니다.
"어떻게 실행하는지"는 [README.md](../README.md), "컨벤션 규칙 자체"는 [CONVENTION.md](CONVENTION.md)를 보세요. 이 문서는 그 중간 — 규칙 뒤에 있는 맥락/이유만 모아둔 것입니다. 새로운 결정이 생기면 항목을 추가하세요.

---

## 1. 레이어 구조 (Controller → Service → Repository → DTO → Error)

**결정**: 도메인별 폴더(`modules/{domain}/`) 안에 controller/service/repository/dto/error를 분리.

**왜**: 인증, 미션, 코칭, 커뮤니티, 결제, 리포트 등 도메인이 많고 서로 독립적으로 늘어날 예정이라(requirements.md 참고), 도메인 단위로 폴더를 나눠야 여러 명이 동시에 작업해도 충돌이 적습니다. Controller에 비즈니스 로직을 두지 않는 이유는, tsoa가 controller를 라우팅/스펙 생성용으로 쓰기 때문에 여기에 로직이 섞이면 스펙과 실제 동작이 어긋나기 쉽기 때문입니다.

## 2. tsoa로 라우팅 + Swagger 자동 생성

**결정**: `*.routes.ts`를 손으로 안 쓰고, 컨트롤러에 `@Route`/`@Get` 등 데코레이터만 붙이면 `tsoa spec-and-routes`가 `generated/routes.ts`와 `swagger.json`을 만들게 함.

**왜**: API 명세(design.md)와 실제 코드가 따로 관리되면 시간이 지나며 어긋나는 게 거의 확정적입니다. tsoa는 컨트롤러 코드 자체가 명세의 원본(source of truth)이 되도록 강제해서 이 문제를 구조적으로 막습니다.

## 3. Zod는 미들웨어 단계에서만 검증

**결정**: tsoa의 `@Body()`는 타입만 추론하고 런타임 검증을 안 하므로, `@Middlewares(validate(스키마))`로 Zod 검증을 별도로 건다. 검증은 컨트롤러 진입 전에 끝내고, 서비스 로직 안에서는 형식 검증을 다시 하지 않는다.

**왜**: "형식이 맞는가"와 "비즈니스 규칙에 맞는가"를 같은 계층에서 섞으면 서비스 코드가 방어 코드로 뒤덮입니다. 형식 검증은 미들웨어가 책임지고, 서비스는 비즈니스 규칙(예: 토큰 잔여량 부족, 모임 정원 초과)만 신경 쓰도록 역할을 나눴습니다.

## 4. 에러 코드 = 도메인 접두사 + 번호

**결정**: `E`(공통), `A`(Auth), `M`(Mission) 등 접두사 + 4자리 숫자로 에러 코드를 부여하고, 도메인별 `*.error.ts`에서 공통 `AppError`를 상속.

**왜**: 프론트엔드가 에러를 분기 처리할 때 HTTP status만으로는 부족합니다(예: 402가 "토큰 부족"인지 "결제 실패"인지 구분 필요). 코드 하나로 어떤 도메인의 어떤 에러인지 바로 알 수 있게 하기 위함입니다 (design.md `## Error Codes` 참고).

## 5. 로깅은 Pino, console 직접 호출 금지

**결정**: `morgan` + 흩어진 `console.log`/`console.error` 대신, 공통 `logger`(Pino) + `pino-http`로 통일. `requestId` 미들웨어가 만든 `X-Request-Id`를 pino-http의 `req.id`로 그대로 연결.

**왜**: 도메인 모듈이 늘어나기 시작하면 로깅 방식이 사람마다/모듈마다 달라지기 쉽습니다. 처음부터 통일된 구조화 로그(JSON)로 가야 나중에 요청 단위로 로그를 추적하거나(같은 `requestId`로 묶기), 운영 환경에서 로그 수집기에 연결하기 쉽습니다. 상세 규칙은 [CONVENTION.md `## 3.11`](CONVENTION.md#311-로깅--pino) 참고.

## 6. `tsoa.json` → `tsoa.config.json` 으로 이름 변경 (비직관적 — 꼭 읽어주세요)

**결정**: tsoa 설정 파일명을 표준값인 `tsoa.json`이 아니라 `tsoa.config.json`으로 바꾸고, 관련 npm 스크립트에 `-c tsoa.config.json` 플래그를 명시.

**왜**: 로컬 환경(Node 24 + `tsx`)에서, 프로젝트 루트에 `tsoa.json` 파일이 있으면 `tsx`로 코드를 실행할 때 `import { Controller } from "tsoa"`가 실제 `tsoa` 패키지가 아니라 루트의 `tsoa.json` 설정 파일을 잘못 가져오는 모듈 해석 충돌이 발생했습니다 (`Controller`가 `undefined`가 되어 `class HealthController extends Controller`에서 크래시). 패키지명과 똑같은 이름의 파일이 루트에 있을 때 생기는 충돌로 보입니다. 파일명을 바꿔서 해결했습니다.

**주의**: 누군가 "표준 관례대로" `tsoa.json`으로 되돌리면 이 버그가 재발할 수 있습니다. 되돌리기 전에 본인 환경(Node/tsx 버전)에서 `npm run dev`가 멀쩡히 뜨는지 꼭 확인하세요.

## 7. tsoa 설정의 `routes.basePath` 제거

**결정**: `tsoa.config.json`의 `routes.basePath: "/api/v1"`를 지웠다 (단, `spec.basePath`는 Swagger 문서 표시용으로 유지).

**왜**: `app.ts`에서 이미 `app.use("/api/v1", router)`로 prefix를 붙이고 있는데, tsoa가 생성하는 라우트 자체에도 `routes.basePath`가 적용돼서 실제 경로가 `/api/v1/api/v1/health`처럼 이중으로 붙는 문제가 있었습니다. prefix는 `app.ts` 쪽에서만 책임지도록 정리했습니다.
