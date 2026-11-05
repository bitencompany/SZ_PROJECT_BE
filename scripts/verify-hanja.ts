import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { catalogImportSchema } from "../src/lib/backend/catalog";
import {
  hanjaResponseSchema,
  nameResponseSchema,
} from "../src/lib/name-contract";

// Only the local backend may receive the BFF secret in this verification tool.
const origin = "http://127.0.0.1:3017";
const secret = process.env.BFF_SHARED_SECRET;
async function request(path: string, body?: unknown, authenticated = true) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (authenticated) headers["X-BFF-Secret"] = secret!;
  return fetch(`${origin}${path}`, {
    method: body ? "POST" : "GET",
    headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: "error",
    signal: AbortSignal.timeout(20000),
  });
}
try {
  assert(secret, "BFF secret must be configured");
  const catalog = catalogImportSchema.parse(
    JSON.parse(await readFile(process.argv[2] ?? ".local/hanja/catalog.json", "utf8")),
  );
  const readings = [...new Set(catalog.entries.map((i) => i.entry.reading))];
  let count = 0;
  for (const reading of readings) {
    const response = await request(
      `/api/hanja?reading=${encodeURIComponent(reading)}`,
    );
    assert.equal(response.status, 200, `Search failed: ${reading}`);
    const result = hanjaResponseSchema.parse(await response.json());
    assert.deepEqual(result.catalog, catalog.catalog);
    const expected = catalog.entries
      .filter((i) => i.entry.reading === reading)
      .map((i) => i.entry)
      .sort((a, b) => a.id.localeCompare(b.id));
    assert.deepEqual(
      result.data.sort((a, b) => a.id.localeCompare(b.id)),
      expected,
    );
    count += result.data.length;
  }
  const selected = [
    ["이", "李"],
    ["서", "書"],
    ["윤", "潤"],
  ].map(([r, c]) => {
    const h = catalog.entries.find(
      (i) => i.entry.reading === r && i.entry.character === c,
    )?.entry;
    assert(h, `Missing validation character: ${r}/${c}`);
    return h;
  });
  const input = { name: "이서윤", hanjaIds: selected.map((h) => h.id) };
  const response = await request("/api/name", input);
  assert.equal(response.status, 200);
  const result = nameResponseSchema.parse(await response.json());
  assert.deepEqual(result.catalog, catalog.catalog);
  assert.deepEqual(
    result.data.hanja.map((h) => h.strokes),
    [7, 10, 16],
  );
  assert.deepEqual(
    result.data.grids.map((g) => g.total),
    [26, 17, 23, 33],
  );
  const filtered = await request(
    `/api/hanja?reading=${encodeURIComponent("윤")}&q=${encodeURIComponent("潤")}`,
  );
  assert.equal(filtered.status, 200);
  assert.deepEqual(
    hanjaResponseSchema
      .parse(await filtered.json())
      .data.map((h) => h.character),
    ["潤"],
  );
  const missing = await request(
    `/api/hanja?reading=${encodeURIComponent("김")}`,
  );
  assert.equal(missing.status, 200);
  assert.deepEqual(hanjaResponseSchema.parse(await missing.json()).data, []);
  assert.equal(
    (
      await request(
        `/api/hanja?reading=${encodeURIComponent("윤")}`,
        undefined,
        false,
      )
    ).status,
    403,
  );
  assert.equal((await request("/api/hanja?reading=invalid")).status, 400);
  assert.equal(
    (await request("/api/name", { ...input, name: "김서윤" })).status,
    400,
  );
  const report = {
    checkedAt: new Date().toISOString(),
    origin,
    catalog: result.catalog,
    readingCount: readings.length,
    matchedEntries: count,
    sample: {
      name: input.name,
      characters: selected.map((h) => h.character).join(""),
      strokes: [7, 10, 16],
      gridTotals: [26, 17, 23, 33],
    },
    checks: [
      `${readings.length}개 독음 HTTP 검색과 반입 데이터 일치`,
      "이서윤 이름 계산 HTTP 200",
      "한자 검색 필터",
      "미수록 김: 빈 목록",
      "BFF 인증 누락 403",
      "잘못된 독음 400",
      "이름·한자 불일치 400",
    ],
    limitations: [
      "부분 공개 자료: 전체 인명용 목록 아님",
      "원획 독립 검수 및 상업 재사용 조건 확인 필요",
      "결제 비활성 유지",
    ],
  };
  await mkdir(".local/verification", { recursive: true });
  await writeFile(
    ".local/verification/hanja-http.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  const escape = (v: string) =>
    v
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  await writeFile(
    ".local/verification/hanja-http.html",
    `<!doctype html><html lang="ko"><meta charset="utf-8"><title>이름결 한자 연동 실행 검증</title><style>body{font:18px/1.6 system-ui;max-width:920px;margin:50px auto;padding:0 28px;color:#203029}h1{font-size:30px}section{padding:20px;background:#edf6ef;border-radius:12px}pre{white-space:pre-wrap;font-size:15px}small{color:#59675d}</style><h1>이름결 한자 연동 실행 검증</h1><small>${escape(report.checkedAt)} · 실제 로컬 HTTP → Supabase</small><section><b>검증 통과: ${readings.length}개 독음 / ${count.toLocaleString()}개 항목</b><p>이서윤 李書潤 · 원획 7 / 10 / 16<br>원격 26 · 형격 17 · 이격 23 · 정격 33</p></section><ul>${report.checks.map((s) => `<li>통과 — ${escape(s)}</li>`).join("")}</ul><h2>현재 제공 범위</h2><p>preview · 전체 인명용 카탈로그가 아닙니다. 김·박 등 미수록 독음은 선택할 수 없습니다. 원획 독립 검수·상업 재사용 조건 확인 전 운영 기능 활성화는 보류합니다.</p><small>출처: <a href="https://jakmyeongdang.com/ai-resources">작명당 공개 JSON</a> · 자료 기준일 2026-10-28</small><pre>${escape(report.catalog.version)}</pre></html>`,
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(
    "한자 HTTP 검증 실패:",
    error instanceof Error ? error.message : "UNKNOWN",
  );
  process.exitCode = 1;
}
