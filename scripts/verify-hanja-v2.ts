import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import postgres from "postgres";
import { catalogImportSchema } from "../src/lib/backend/catalog";
import { hanjaResponseSchema, nameResponseSchema } from "../src/lib/name-contract";

const catalog = catalogImportSchema.parse(JSON.parse(await readFile(".local/hanja-replacement/catalog-v2.json", "utf8")));
const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false, onnotice: () => {} });
const origin = "http://127.0.0.1:3017";
async function request(path: string, body?: unknown) {
  const response = await fetch(`${origin}${path}`, {
    method: body ? "POST" : "GET",
    headers: { "X-BFF-Secret": process.env.BFF_SHARED_SECRET!, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "error", signal: AbortSignal.timeout(20000),
  });
  assert.equal(response.status, 200, path);
  return response.json();
}
try {
  assert(process.env.DATABASE_URL && process.env.BFF_SHARED_SECRET, "환경 설정 필요");
  const active = await sql`select version from private.active_catalog`;
  assert.equal(active[0].version, catalog.catalog.version);
  const stored = await sql`select entry from private.catalog_entries where version=${catalog.catalog.version}`;
  const sort = (items: { id: string }[]) => items.sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(sort(stored.map((row) => row.entry)), sort(catalog.entries.map(({ entry }) => entry)));
  const readings = ["김", "박", "최", "강", "태", "은", "악", "락", "낙", "요", "리", "이"];
  for (const reading of readings) {
    const result = hanjaResponseSchema.parse(await request(`/api/hanja?${new URLSearchParams({ reading })}`));
    assert.deepEqual(result.catalog, catalog.catalog);
    assert.deepEqual(sort(result.data), sort(catalog.entries.filter(({ entry }) => entry.reading === reading).map(({ entry }) => entry)));
  }
  for (const [reading, q, character] of [["강", "진주 강", "姜"], ["강", "진주강씨", "姜"], ["강", "성 강", "姜"], ["태", "통할태", "泰"], ["악", "풍류 악", "樂"]]) {
    const result = hanjaResponseSchema.parse(await request(`/api/hanja?${new URLSearchParams({ reading, q })}`));
    assert(result.data.some((item) => item.character === character), `${reading}/${q}`);
  }
  const chosen = [["강", "康"], ["태", "泰"], ["은", "殷"]].map(([reading, character]) => {
    const entry = catalog.entries.find(({ entry }) => entry.reading === reading && entry.character === character)?.entry;
    assert(entry); return entry;
  });
  const result = nameResponseSchema.parse(await request("/api/name", { name: "강태은", hanjaIds: chosen.map((item) => item.id) }));
  assert.deepEqual(result.data.hanja.map((item) => item.dictionaryStrokes), [11, 10, 10]);
  assert.deepEqual(result.data.grids.map((grid) => grid.total), [20, 21, 21, 31]);
  const report = { version: catalog.catalog.version, databaseEntriesMatched: stored.length, httpReadingsMatched: readings, searchCases: 5, writtenStrokeTotals: [20, 21, 21, 31], checkedAt: new Date().toISOString() };
  await mkdir(".local/verification", { recursive: true });
  await writeFile(".local/verification/hanja-v2.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
} catch {
  console.error("한자 v2 검증 실패: 활성 버전, DB 항목, HTTP 응답, 필획 합계를 확인하세요.");
  process.exitCode = 1;
} finally {
  await sql.end();
}
