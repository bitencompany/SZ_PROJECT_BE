# SAZU 무료 테스트 연결 및 프론트 작업

기준일: 2026-11-05. 현재 상태: **연동 코드와 실행 검증 명령 준비, 무료 키 미설정으로 실제 SAZU 호출 미검증**. BE와 FE `.env.local` 모두 SAZU 키가 없는 것을 값 노출 없이 확인했습니다. 결제 비활성은 유지합니다.

## 무료 테스트 범위

[SAZU 공식 문서](https://www.sazu.app/manse-api/docs)에 따르면 Free 키는 지정 샘플 입력으로 응답 구조를 검증하는 용도입니다. 임의 출생정보의 실제 개인 분석을 제공하는 무료 요금제가 아닙니다. 공식 샘플은 `GET https://api.sazu.app/v2/sazu/samples`에서 받습니다. 샘플 목록 조회는 월 포함량을 소비하지 않으며 분당 한도는 적용됩니다. 현재 문서상 Free 한도는 월 500회, 분당 10회입니다.

키 발급: https://www.sazu.app/manse-api/dashboard/keys

키는 BE `.env.local`의 `SAZU_API_KEY`에만 저장합니다. 채팅, Git, FE 환경변수, `NEXT_PUBLIC_` 변수에 넣지 않습니다. 무료 키 접두사는 `sazu_free_`입니다.

## 연결 및 검증

1. BE `.env.local`에 무료 키를 설정합니다.
2. 로컬 환경에서 `PREVIEW_ENABLED=true`로 변경하고 BE 개발 서버에 새 환경변수를 반영합니다. 운영 배포 설정 변경과는 별개입니다.
3. BE를 `npm run dev`로 실행합니다. 기존 서버가 3017에서 실행 중이면 중복 실행하지 않습니다.
4. `npm run sazu:verify`를 실행합니다.

검증 명령은 유료 키를 거부하고 고정 로컬 주소 `http://127.0.0.1:3017`에만 BFF 비밀을 전달합니다. 공식 목록에서 양력·시간 명시 샘플 하나를 선택해 다음을 확인합니다.

- 공식 SAZU SDK의 실제 `readings.manse` 응답을 현재 런타임 스키마로 검증
- `POST /api/sazu/preview` 성공과 직접 분석 응답의 공개 필드 일치
- `source=SAZU`, `sandbox=true`, 공급자 버전, 만료 시간
- 같은 입력 재요청 시 동일 `previewId`, 만료 시각 및 결과 재사용
- BFF 인증 누락 403, 잘못된 출생시간 400

정상 실행 시 외부 요청은 샘플 목록 1회와 직접 분석 1회, 미리보기 캐시가 없을 경우 분석 1회입니다. SDK 자동 재시도는 하지 않습니다. 미리보기 검증은 실제 DB에 30분 유효 결과와 사용량 기록을 저장합니다. 검증 성공 보고서는 Git에서 제외된 `.local/verification/sazu-http.json`에 기록됩니다. 보고서의 `checkedAt`을 확인해 최신 실행인지 판단합니다.

음력·윤달·시간 미상 실제 호출, 프론트 화면 클릭 E2E, 유료 키를 통한 실제 개인 분석은 이 명령의 검증 범위가 아닙니다. 합성 데이터 단위 테스트 통과를 실제 외부 연결 성공으로 간주하지 않습니다.

## 프론트 계약 및 후속 작업

엔드포인트와 필드는 기존 `docs/BACKEND_API.md`의 계약을 유지합니다. 프론트 서버 BFF가 `POST /api/sazu/preview`에 `{ birth: BirthInput }`을 전송합니다. `X-BFF-Secret`, 신뢰 가능한 `X-Client-IP`, UUID인 `X-Anonymous-ID`가 필요합니다. 브라우저에서 SAZU를 직접 호출하지 않습니다.

성공 응답은 `success=true`, `data={ source, sandbox, modules, previewId, expiresAt, providerVersion }`입니다. 공개 모듈은 사주 네 기둥과 선택적 오행뿐입니다. 시간 미상의 시주는 null, 오행 누락은 미제공으로 표시합니다.

- 실제 검증 성공 후 보고서의 `sample.birth`를 샘플 입력 버튼에 사용합니다. 사용자의 입력을 몰래 샘플로 치환하지 않습니다.
- `sandbox=true`이면 “무료 샘플 결과 · 실제 입력에 대한 개인 분석 아님”을 표시합니다. 유료 풀이/결제 흐름에 연결하지 않습니다.
- `400 SAMPLE_PROFILE_REQUIRED`이면 샘플 입력 안내를 제공합니다. 사용자의 날짜가 잘못되었다고 안내하지 않습니다.
- `503 PREVIEW_NOT_READY` 또는 `NOT_CONFIGURED`는 준비 중, `429 RATE_LIMITED`는 잠시 후 재시도 상태로 표시합니다. 자동 반복 호출을 피합니다.
- `previewId`와 `expiresAt`을 응답 그대로 보관하고, 출생정보 변경 시 이전 연결을 해제합니다. 보관 API로 넘기는 필드는 기존 계약을 따릅니다.
- 개발 전용 `/api/sazu`를 운영 경로로 사용하지 않습니다. 운영에서는 해당 경로가 503으로 차단됩니다.

FE 소스 확인 결과 `src/lib/sazu.ts`가 신규 미리보기 경로를 사용하며, `sazu-contract.ts`에 sandbox 구분, `backend.ts`에 샘플 요구 오류 처리가 있습니다. 실제 화면 표시와 성공 E2E는 아직 확인하지 않았습니다.

## 이번 실행 상태

`npm run sazu:verify` 실행 결과: `SAZU_API_KEY를 .env.local에 설정해 주세요.`로 외부 호출 전 종료했습니다. 실제 SAZU 성공 응답이나 미리보기 저장 성공을 주장할 수 없는 상태입니다. 무료 키 설정 후 위 절차로 이어서 검증해야 합니다.
