# Supabase DB 연결·적용 완료 및 프론트 후속 작업

2026-11-10 재검증: migration 체크섬·RLS·직접 쓰기 차단·JSON 객체 저장·활성 한자 카탈로그 검사 모두 통과. 실제 DB 다중 연결의 advisory lock과 사용량 제한(10개 동시 요청 중 2개 허용/8개 차단), 검증용 키 0건 잔존 확인. 최신 기록은 [운영 점검 결과](./OPERATIONS_STATUS_20261110.md)를 따릅니다.

2026-11-05 갱신: [한자 연동 결과](./HANJA_INTEGRATION_20261105.md). 기존 빈 카탈로그 대신 58개 독음·2,941개 항목의 부분 `preview` 카탈로그를 반입·활성화했고 실제 HTTP 조회·이름 계산을 검증했습니다. 아래 11월 4일의 `CATALOG_NOT_READY` 결과는 반입 이전 이력입니다. 전체 검수·상업 이용 조건은 미완료이며 FE 운영 기능과 결제는 비활성을 유지합니다.

확인일: 2026-11-04. 이 문서는 실제 프로젝트 상태를 기록합니다. API 계약과 FE 작업 목록은 [FRONTEND_HANDOFF.md](./FRONTEND_HANDOFF.md), [BACKEND_API.md](./BACKEND_API.md)를 따릅니다.

## 확인 완료

- 조직: 이름결, Free.
- 프로젝트: `OscarKang1's Project`, 참조 ID `vsiqcaajtnlsflfslirc`.
- [대시보드](https://supabase.com/dashboard/project/vsiqcaajtnlsflfslirc).
- 지역: Singapore (`ap-southeast-1`).
- 프로젝트 URL: `https://vsiqcaajtnlsflfslirc.supabase.co`.
- transaction pooler: `aws-0-ap-southeast-1.pooler.supabase.com:6543`, DB `postgres`, 사용자 `postgres.vsiqcaajtnlsflfslirc`.
- `202610300001_readings.sql`, `202610300002_backend.sql` 원격 적용 완료. migration 체크섬 일치 확인.
- public 테이블 3개(`reading_requests`, `orders`, `readings`), private 테이블 11개(migration 이력 포함) 생성 확인.
- BE `.env.local`에 프로젝트 URL·풀러 호스트·DATABASE_URL·서버 비밀 4개 설정. 파일 권한 0600, Git 제외. 비밀값은 문서에 기재하지 않습니다.
- FE `.env.local`에 같은 프로젝트 URL·공개 키·BFF 서버 비밀, `BACKEND_API_URL=http://127.0.0.1:3017`, `APP_URL=http://127.0.0.1:3000`, `BACKEND_NAME_ENABLED=false` 설정. 파일 권한 0600. DB 비밀번호는 FE에 전달하지 않았습니다.
- Supabase 공개 키 인증 성공, JWKS에 BE와 호환되는 ES256 서명키 확인.

## 카카오 로그인 연결 진행

- 카카오 앱: [이름결, ID 1636789](https://developers.kakao.com/console/app/1636789).
- 사용자 승인 후 기존 REST API 키·로그인 Client Secret을 이름결 Supabase에 저장했습니다. 시크릿 재발급이나 보안 비활성화는 하지 않았습니다. 키 값은 코드·문서에 저장하지 않았습니다.
- Supabase `Kakao enabled`, `Allow users without an email` 저장 완료. Auth 설정 API에서도 `external.kakao=true`를 확인했습니다.
- 카카오 로그인 사용 설정 ON 저장 완료. `profile_nickname`·`profile_image` 모두 **선택 동의**로 저장된 목록을 확인했습니다. 이메일 권한을 요구하지 않습니다.
- 카카오 REST API 키의 로그인 리다이렉트 URI에 `https://vsiqcaajtnlsflfslirc.supabase.co/auth/v1/callback`을 저장했고, 플랫폼 키 목록의 로그인 리다이렉트 URI 등록 표시를 확인했습니다.
- Supabase Site URL `http://127.0.0.1:3000`, Redirect URLs `http://127.0.0.1:3000/auth/callback` 저장 완료. URL 목록 1건 및 성공 알림을 확인했습니다.
- FE 인증 정책 테스트 4개 통과. 실제 로컬 HTTP에서 OAuth 시작 303, Kakao 공급자·프로젝트·콜백·scope·PKCE S256·HttpOnly 쿠키, 다른 Origin의 POST 403, 취소 콜백의 로그인 화면 복귀를 확인했습니다.
- 기존 FE 개발 서버가 3026에서 실행 중이어서 검증 때 임시 로컬 프록시(3000→3026)를 사용했습니다. 정상 개발 실행 기준은 `APP_URL`과 브라우저 접속 주소를 모두 `http://127.0.0.1:3000`으로 일치시키는 것입니다.
- 실제 카카오 계정 동의 이후 세션 생성·회원 저장·만료 검증은 미완료입니다. 브라우저 제어 도구가 로컬 로그인 페이지의 제목·주소만 읽고 본문을 반환하지 않아 로그인 버튼 이후를 진행하지 못했습니다. 설정 저장과 HTTP 검증만으로 전체 로그인 E2E 완료로 판단하지 않습니다.
- 수동 확인 진입점: `http://127.0.0.1:3000/login`. 검증용 로컬 프록시가 실행 중이며, 기존 3026 FE 서버가 유지되어야 합니다. 카카오 동의 후 서비스 화면 복귀, 새로고침 시 로그인 유지, 로그아웃 후 보호 화면 차단을 확인합니다. 실제 인증 코드·토큰·쿠키 값은 문서나 로그에 남기지 않습니다.

## 원격 검증 결과

| 검증 | 결과 |
| --- | --- |
| public 3개 테이블 RLS | 활성화 |
| anon/authenticated의 private 스키마 접근 | 차단 |
| authenticated의 reading_requests 직접 INSERT | 권한 오류로 차단 |
| service_role의 서비스 테이블 쓰기·private 읽기 | 성공 |
| 회원 A가 A/B의 요청·주문·결과 조회 | A의 데이터만 반환 |
| 결제 상태를 refunded로 변경한 결과 조회 | 결과 숨김 |
| anon의 요청 조회 | 권한 오류로 차단 |
| 검증용 회원·요청·주문·결과 | 단일 트랜잭션 전체 롤백, 잔존 회원/요청 0건 확인 |
| BFF 비밀 없는 한자 API 핸들러 | 403 |
| FE와 같은 BFF 비밀로 실제 DB를 조회한 한자 API 핸들러 | 503 CATALOG_NOT_READY: 실제 검수 카탈로그 미반입 |
| 결제 공급자 진입점 | PAYMENT_NOT_READY 유지 |

API 확인은 Route Handler를 직접 호출한 검증입니다. 배포된 HTTP 서비스나 실제 카카오 로그인 E2E 검증을 뜻하지 않습니다. 검증은 실제 PG 또는 유료 외부 분석 API를 호출하지 않았습니다.

## 재연결 시에만 사용할 명령

현재 연결은 완료되어 있으므로 다시 입력할 필요가 없습니다. 향후 로컬 DB 연결을 다시 설정할 때만 BE 저장소 터미널에서 실행합니다.

```sh
npm run db:connect
```

프로젝트 생성 때 정한 비밀번호를 입력하면 화면에 표시하지 않고 TLS 접속·`service_role` 전환을 검증한 후 `.env.local`의 `DATABASE_URL`에 저장합니다. Supabase의 비밀번호 자체는 변경하지 않습니다. 명령 인수나 셸 이력에 비밀번호를 넣지 않습니다.

## 프론트 전달 사항

- **로컬 연결 설정은 완료했습니다.** 실행 중인 FE/BE 개발 서버가 있다면 환경변수가 반영되도록 재시작합니다. 운영 배포 환경변수는 별도로 설정해야 합니다.
- 신규 BE BFF를 통한 입력 저장 경로를 사용합니다. 기존 Supabase 직접 insert는 현재 차단되어 있습니다.
- **Supabase·카카오 설정은 완료했고 실제 계정 로그인 E2E 검증은 남아 있습니다.** 로그인 성공/취소/만료 및 회원 저장 흐름을 검증합니다. 닉네임·사진은 선택 동의이므로 누락될 때 기본 표시를 사용합니다.
- 실제 검수 카탈로그가 없어 한자 API는 CATALOG_NOT_READY를 반환합니다. 원격 DB 적용만으로 이름 입력 저장 전체 흐름까지 활성화되지는 않습니다.
- `BACKEND_NAME_ENABLED=false`, BE `PREVIEW_ENABLED=false`, 결제 비활성을 유지합니다. 한자 검수 데이터와 SAZU 실키·실응답 확인 후 기능별 활성화합니다.
- AI 키·모델 실검증, 운영 도메인·배포·작업 스케줄 설정, PG 계약/어댑터는 아직 미완료입니다.
- API 엔드포인트·필드 변경은 없습니다. 이 문서는 배포 설정의 진행 상태만 갱신합니다.

FE 전달본: `SZ_PROJECT_FE/BACKEND_SUPABASE_STATUS_20261104.md`. 2026-10-30 계약 문서의 환경 준비 상태보다 이 문서의 상태가 최신입니다.
