# 한자 공급 데이터 v2 교체 — 2026-11-05

## 적용 결과

- 활성 개발 카탈로그: `hanja-v2-20261105-3f3f508f6e80`. 운영 배포/결제 개통 아님.
- 2,944개 항목·59개 독음 → 9,904개 항목·486개 독음. 독음이 다르면 같은 글자도 별도 항목이다.
- 한국어 뜻 출처 확보 7,208개, 미확보 2,696개. 미확보를 추측하거나 이전 작명당 뜻으로 대체하지 않는다.
- 기존 ID 2,941개 보존. 새 목록에서 대응하지 않은 愞의 나/연/유 3개는 자동 이체자 치환 없이 제외했다. 이는 법적으로 사용할 수 없다는 판정이 아니다.
- 비표준 코드/부적합 독음 443쌍 제외. 전체 공식 목록 또는 최신 법적 사용 가능 여부를 보증하지 않는다.
- 실제 필획만 표시·계산. 泰 10, 康 11, 江 6. v2는 `strokes == dictionaryStrokes`, `strokeBasis=written`.

## 출처와 선택 이유

1. 글자·독음: [Korean-Name-Hanja-Charset 법원 수집본](https://raw.githubusercontent.com/rutopio/Korean-Name-Hanja-Charset/12df1ba1b4dfaa095813e4ddfba424e816f94c53/data-gov.csv). 2024 자료의 공개 수집본이며 법원 실시간 API가 아니다. 네이버 사전 수집 데이터는 사용하지 않았다.
2. 한국어 훈음: [libhangul hanja.txt](https://raw.githubusercontent.com/libhangul/libhangul/23d2cd9d10d516d523d60c562dbcc7ea08139a09/data/hanja/hanja.txt). 라이브러리와 별도로 데이터 파일 상단의 BSD-3-Clause 조건을 적용하며 `LIBHANGUL-DATA-LICENSE.txt`에 보존했다.
3. 필획: [Unicode Unihan 17.0.0](https://www.unicode.org/Public/17.0.0/ucd/Unihan.zip). `kTotalStrokes`, 한국 K 자형에 별도 값이 있으면 `kAlternateTotalStrokes` 우선.

SAJA API는 한국어 풀이가 기초 128자뿐이라고 안내하므로 교체안에서 제외했다: https://www.sajaquiz.com/developers/ . hanjadict는 현재 사전 데이터를 포함하지 않는 조회 도구이므로 단독 해결책이 아니다: https://github.com/seyoungsong/hanjadict .

## 계약

- `meaning`: 해당 독음 사전 항목의 첫 번째 확보된 뜻. 여러 뜻을 합친 문자열이 아니다.
- `meanings`: 같은 독음의 추가 뜻까지 보존. 모든 뜻+음 조합을 검색한다.
- `meaningStatus`: `sourced` 또는 `unavailable`. sourced는 전수 검수 완료를 의미하지 않는다.
- `meaningSource`, `readingSource`: 서로 별도 출처.
- `searchAliases`: 본관 등 검색 별칭. 진주 강/진주강씨 검색을 유지한다.
- 훈음 파서는 명시적으로 해당 독음에 색인된 행만 읽는다. 역사적 첫소리가 남은 훈음(이:李:오얏 리)은 두음 대응을 검사하고, 다른 독음이나 파싱 불가능한 문구는 가져오지 않는다.
- FE의 오프라인 예시 63개도 동일 파이프라인에서 생성한다.

## 재현

BE에서 실행:

```sh
npm run catalog:fetch
npm run catalog:build
python3 -m unittest discover -s tests -p '*_test.py'
# 새 버전 최초 반입에만 사용. 같은 버전 중복 반입은 거절됨.
npm run catalog:import -- .local/hanja-replacement/catalog-v2.json --activate
npm run catalog:verify
```

Node와 Python 3 표준 라이브러리가 필요하다. 다운로드는 고정 커밋을 사용하고 Unihan ZIP은 SHA-256을 대조한다. 원본과 변환본은 `.local/hanja-replacement/`, 변경·누락 보고서는 `migration-report.json`과 `source-report.json`, 훈음 원문별 파싱 근거는 `gloss-audit.json`이다. 기존 작명당 명령은 `catalog:fetch:legacy`/`catalog:verify:legacy`로 격리했다. 이전 DB 버전도 보존되어 있다.

## 검증과 남은 범위

DB 9,904개 전수 대조, 12개 독음의 실제 HTTP 전체 응답 대조, 본관/추가 뜻 검색 5건 및 康泰殷 필획 11/10/10 → 수리 20/21/21/31 확인. FE 54개·BE 60개·Python 3개 테스트, 양쪽 빌드 및 BE lint 통과.

아직 남은 작업은 한국어 뜻 미확보 2,696개 보강, 사전별 대표 훈 차이 검수, 법원 최신 원문 전수 대조다. 유료 사전 데이터 조사 허용 여부는 사용자에게 질문했으며 아직 답변 전이다. 전체 정확성 검증이 끝났다고 표시하지 않는다.
