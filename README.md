# SZ_PROJECT_BE

백엔드 전용 저장소입니다. 프론트 화면은 `../SZ_PROJECT_FE`에서 관리합니다.
Next.js App Router의 Route Handler를 API 서버로 사용합니다. React 의존성은 Next.js 런타임용으로 유지하며 서비스 화면은 포함하지 않습니다.

## 실행

```sh
npm ci
# .env.local이 없으면 .env.example을 복사하고 SAZU_API_KEY 설정
npm run dev
```

개발 API 주소: `http://127.0.0.1:3017/api/sazu`. 키는 백엔드 `.env.local`에만 보관합니다.

## 구현 범위

- `POST /api/sazu`: 출생 정보 검증, SAZU v2 조회, 응답 검증.
- 날짜·시간 미상·음력/윤달 검증, 공급자 오류 변환, 요청 크기 제한, 응답 캐시 금지.
- 실제 발급 키를 이용한 성공 응답 검증은 아직 하지 않았습니다.
- 결제·주문 소유권 검증 구현 전에는 production 환경의 분석 요청을 차단합니다.
- 미구현: NICE 결제, 주문/사용자 DB, 인증, 영속 호출 제한, 한자 데이터·성명학 API, AI 해설.

프론트 전달용 계약: [docs/BACKEND_API.md](docs/BACKEND_API.md).
기획 원본은 `ai.md`, `code_artifact.md`이며 프론트 저장소에도 동일한 파일이 있습니다.

## 검증

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

서버 테스트는 외부 응답을 대체하여 계약·입력 검증·오류 처리를 확인합니다. 실제 SAZU 호출 성공을 의미하지 않습니다.
