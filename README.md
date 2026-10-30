# SZ_PROJECT_BE

이름결 백엔드 전용 저장소입니다. FE는 `../SZ_PROJECT_FE`에서 관리합니다. Next.js Route Handler와 Supabase PostgreSQL/JWT를 사용합니다.

## 실행

```sh
npm ci
# .env.example을 참고해 .env.local 설정
npm run dev
```

개발 주소: `http://127.0.0.1:3017`. 신규 API는 FE 서버의 `X-BFF-Secret`이 필요하며 회원 API는 Supabase Bearer 토큰도 검증합니다.

## 구현 상태

- 한자 카탈로그 DB/검수 근거 반입 도구, 한자 조회·서버 성명학 계산.
- 운영용 사주 미리보기: DB 한도/호출 예산/중복 병합, 입력 해시, 30분 previewId.
- JWT 인증·소유권, 불변 입력 저장, 제한/미구매 삭제/보관 정리.
- 주문 스냅샷·서버 가격·멱등 이벤트·환불 접근 회수·생성 작업 코어.
- OpenAI 구조화 텍스트 생성·재시도·본인 paid 결과 조회.
- 마이그레이션·Vercel Cron 설정·PGlite RLS/상태 처리 테스트.

**PG 계약 전이므로 실제 결제 API는 503 PAYMENT_NOT_READY로 비활성입니다.** PG 어댑터/대사 작업은 후속 구현입니다. 전체 검수 한자 데이터, 신규 Supabase/카카오 설정, SAZU/OpenAI 실키와 실호출 검증도 아직 없습니다. 예시 데이터를 운영 분석이나 결제로 대체하지 않습니다. 기존 `/api/sazu`는 개발 호환용이며 production 차단을 유지합니다.

## 문서

- [프론트 후속 작업](docs/FRONTEND_HANDOFF.md)
- [현재 API 계약](docs/BACKEND_API.md)
- [운영 서비스 가입·환경변수·DB·카탈로그·배포 준비](docs/OPERATIONS_SETUP.md)
- [프론트 원본 요청서](docs/BACKEND_IMPLEMENTATION_REQUEST.md)

## 검증

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

외부 공급자는 테스트에서 대체합니다. PGlite는 실제 PostgreSQL 엔진을 사용하지만 단일 연결 테스트이므로 원격 다중 연결 경합/실결제/OAuth 성공을 의미하지 않습니다. 실환경 인수 항목은 운영 문서를 참고하세요.
