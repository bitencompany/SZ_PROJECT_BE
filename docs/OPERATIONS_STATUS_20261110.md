# 2026-11-10 백엔드 운영 점검

이 문서는 README 및 과거 설정 문서보다 최신입니다. 개발 연결과 검증은 진행됐지만 유료 서비스 개통 완료를 뜻하지 않습니다.

## 완료한 작업

- Supabase: 실제 원격 DB의 migration 2개 체크섬, 서비스 3개 테이블 RLS, anon/authenticated의 private 접근·직접 쓰기 차단, service_role 조회, 저장 JSON 객체를 재검증했습니다. 읽기 전용 `npm run ops:verify`로 반복할 수 있습니다.
- 동시성: 실제 PostgreSQL의 서로 다른 연결에서 transaction advisory lock의 배타성과 해제를 확인했습니다. 10개 동시 사용량 요청은 한도 2개만 성공하고 나머지 8개는 RATE_LIMITED를 반환했습니다. 임시 검증 키 삭제 후 잔존 0건입니다. 회원·주문·결제·외부 분석 API는 건드리지 않았습니다.
- 한자: libhangul의 해당 독음 행에 있는 독음 생략 순한글 뜻 101개를 복원했습니다. 9,904개 항목·486개 독음의 ID와 필획은 그대로입니다. 새 preview 버전 `hanja-v2-20261105-a7501e11d71e`를 원격 DB에 반입·활성화했고 이전 버전은 보존했습니다. 뜻 확보 7,309개, 미확보 2,595개입니다. 서로 다른 독음과 이체자 참조 문구를 자동 치환하지 않습니다.
- 한자 검증: DB 9,904개 전수 대조, 실제 HTTP 12개 독음 전체 응답, 본관·뜻 검색 5건, 康泰殷 필획 11/10/10과 수리 20/21/21/31 대조 통과.
- 배포: 공개 생존 확인 `GET /api/health`와 GitHub Actions 검증 workflow를 추가했습니다. health는 프로세스 생존만 뜻하며 DB 연결·유료 준비 여부를 노출하거나 보증하지 않습니다.
- 타입 검사: 설치된 Next.js 안내에 따라 `next typegen && tsc --noEmit`으로 변경해 새 checkout에서도 route 타입을 먼저 생성합니다.
- Vercel: INHA Chrome 프로필의 `OSCAR / ojackgyo-project` Hobby 계정에 FE·BE 프로젝트가 생성됐고 Production 배포 완료 화면을 확인했습니다. FE `https://sz-project-fe.vercel.app`, BE `https://sz-project-be.vercel.app`. BE는 main `219e0c1`, GitHub Actions [42758190375](https://github.com/bitencompany/SZ_PROJECT_BE/actions/runs/42758190375) 성공입니다. 환경변수는 사용자가 직접 설정하기로 선택했으므로 비밀값은 Vercel로 전송하지 않았습니다. 분 단위 Cron이 배포를 막지 않도록 기본 설정에는 일일 정리만 남겼으며 결제 개통 전 생성 worker 스케줄을 추가해야 합니다.
- SAZU: INHA 대시보드에서 활성 FREE 샘플 키 1개를 확인했습니다. 기존 로컬 키도 무료 샘플용입니다. 개인 분석용 유료 키를 생성하거나 요금제를 변경하지 않았습니다.

## 검증 명령과 증거

```sh
npm run lint
npm run typecheck
npm test
python3 -m unittest discover -s tests -p '*_test.py'
npm run build
npm run catalog:verify
npm run ops:verify
npm run db:verify:concurrency
```

BE 테스트 60개·Python 파서 테스트 5개 통과. 원격 검증 시각은 2026-11-10 12:58 KST입니다. Git 제외 `.local/verification/hanja-v2.json`, `operations.json`, `concurrency.json`에 비밀값 없는 보고서를 저장합니다. 검증 명령은 raw DB 오류·회원 입력·키를 출력하지 않습니다.

2026-11-10 13:53 KST 배포 HTTP 검증: `https://sz-project-be.vercel.app/api/health`는 200과 `{status:"ok",service:"sz-project-be"}`를 반환했습니다. 비밀을 보내지 않은 `/api/hanja`는 배포 환경변수 미설정 상태에서 503 `NOT_CONFIGURED`를 반환했습니다. 환경변수 직접 설정 후 인증 포함 기능 재검증이 필요합니다.

`ops:verify`의 성공은 기술 검사만 뜻합니다. `--release`를 붙이면 현재 출시 차단 항목 때문에 종료 코드 1을 반환합니다. 실제 계정 로그인·공급자 품질·정책 인수는 이 명령이 판정하지 않습니다.

한자 재생성 시 BE만 변경하려면 `npm run catalog:build -- --skip-fe`를 사용합니다. 기본 명령은 기존처럼 FE 오프라인 예시도 생성하므로 FE 작업과 조율해야 합니다.

## 남은 작업과 조건

| 항목 | 필요한 조건 / 후속 작업 |
| --- | --- |
| 한자 검수 | 미확보 2,595개를 위한 추가 이용 가능 출처, 원문 오탈자·대표 훈 검수, 법원 최신 원문 대조. sourced는 전수 검수 완료를 뜻하지 않음 |
| 개인 사주 | SAZU 개인 분석용 키/이용 요금 확정, 음력·윤달·시간 미상 실응답 및 품질 검증 |
| AI 상세 풀이 | BE 전용 OPENAI_API_KEY·OPENAI_MODEL 설정, 실제 모델 응답 품질 인수. 현재 로컬에 두 값 모두 없음 |
| 카카오 로그인 | FE에서 실계정 로그인·프로필 동의 거절·입력 저장·새로고침·로그아웃 보호 경로 차단·재로그인 후 입력 유지 검증 완료. 운영 도메인 콜백 설정과 배포 환경에서의 로그인은 별도 검증 필요 |
| 결제 | PG·상품/가격/환불 정책 확정 후 prepare/confirm/webhook/refund 및 대사 어댑터 구현·실거래 검증. 현재 PAYMENT_NOT_READY 유지 |
| 보관·탈퇴 | 주문 연결 데이터 보관·삭제/탈퇴 정책 확정과 구현. 현재 미구매 요청 삭제·30일 정리만 구현 |
| 배포 | FE/BE Production 배포 완료. 사용자가 Vercel 환경변수·Supabase 운영 OAuth 콜백을 직접 설정하고 재배포한 뒤 기능 연결을 검증해야 함 |
| 생성 작업 | 결제 활성화 전에 분 단위 scheduler/worker 구성·재시도/오류 감시 검증 |
| 추가 원격 경합 | 주문 승인·웹훅 경합, worker 중복 실행·환불 중 생성·장애 복구. 이번 검사는 잠금·사용량 제한만 검증 |

키는 채팅·Git에 넣지 않고 BE 전용 환경변수로 설정합니다. DB 준비만으로 결제 또는 실제 개인 분석을 켜지 않습니다. 요금제 변경·PG 계약·신규 비밀키 생성·운영 기능 개통은 완료한 것으로 표시하지 않습니다.

## 사용자가 직접 입력할 배포 환경변수

BE [Environment Variables](https://vercel.com/ojackgyo-project/sz-project-be/settings/environment-variables)의 **Production**에 기존 BE `.env.local` 값을 복사합니다. `DATABASE_URL`, `SUPABASE_URL`, `BFF_SHARED_SECRET`, `INPUT_HASH_SECRET`, `WORKER_SECRET`, `CRON_SECRET`, `SAZU_API_KEY`, `PREVIEW_ENABLED=true`입니다. 무료 키는 공식 샘플만 처리합니다. 선택적으로 `SAZU_DAILY_CALL_BUDGET=100`을 명시할 수 있습니다. `SUPABASE_DB_POOLER_HOST`는 로컬 연결 도구용이므로 배포 런타임에는 필요하지 않습니다. OpenAI 키·모델은 준비됐을 때 별도로 설정합니다.

FE에는 `BACKEND_API_URL=https://sz-project-be.vercel.app`, `APP_URL=https://sz-project-fe.vercel.app`, 같은 `BFF_SHARED_SECRET`을 설정합니다. 나머지 Supabase 공개 설정과 기능 플래그는 FE 배포 문서를 따릅니다. BE의 DB URL·SAZU 키·작업 비밀을 FE에 넣지 않습니다. 로컬 전용 `PREVIEW_IP_SOURCE=local`을 운영에 복사하지 않습니다.

Supabase Auth URL 설정에 운영 Site URL `https://sz-project-fe.vercel.app`, 허용 Redirect URL `https://sz-project-fe.vercel.app/auth/callback`을 추가합니다. Kakao의 공급자 콜백은 기존 Supabase `/auth/v1/callback`을 유지합니다. 환경변수 저장 후 BE·FE를 모두 재배포해야 실행 중인 배포에 반영됩니다.
