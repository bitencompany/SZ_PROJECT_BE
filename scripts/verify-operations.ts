import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import postgres from "postgres";

// 읽기 전용 검사. 공급자 호출·회원 생성·migration 적용·결제는 수행하지 않습니다.
const checks: { name: string; ok: boolean }[] = [];
const blockers: string[] = [];
let sql: postgres.Sql | undefined;
async function check(name: string, run: () => Promise<void> | void) {
  try {
    await run();
    checks.push({ name, ok: true });
  } catch {
    checks.push({ name, ok: false });
  }
}

await check("required_server_environment", () => {
  for (const key of ["DATABASE_URL", "SUPABASE_URL", "BFF_SHARED_SECRET", "INPUT_HASH_SECRET", "WORKER_SECRET", "CRON_SECRET"])
    assert(process.env[key]?.trim());
  const secrets = ["BFF_SHARED_SECRET", "INPUT_HASH_SECRET", "WORKER_SECRET", "CRON_SECRET"].map((key) => process.env[key]!.trim());
  assert(secrets.every((value) => value.length >= 32));
  assert.equal(new Set(secrets).size, secrets.length);
  assert.equal(new URL(process.env.SUPABASE_URL!).protocol, "https:");
  const dbUrl = new URL(process.env.DATABASE_URL!);
  assert(["postgres:", "postgresql:"].includes(dbUrl.protocol));
  assert(["require", "verify-full", "verify-ca"].includes(dbUrl.searchParams.get("sslmode") ?? ""));
});

if (process.env.DATABASE_URL) {
  sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, connect_timeout: 10, onnotice: () => {} });
  const connection = sql;
  await check("migration_checksums", async () => {
    const directory = new URL("../supabase/migrations/", import.meta.url);
    const files = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
    const rows = await connection<{ name: string; sha256: string }[]>`select name,sha256 from private.backend_migrations`;
    assert.equal(rows.length, files.length);
    for (const name of files) {
      const hash = createHash("sha256").update(await readFile(new URL(name, directory))).digest("hex");
      assert.equal(rows.find((row) => row.name === name)?.sha256, hash);
    }
  });
  await check("rls_and_direct_write_boundary", async () => {
    const rows = await connection`select relname,relrowsecurity from pg_class where oid in ('public.reading_requests'::regclass,'public.orders'::regclass,'public.readings'::regclass)`;
    assert.equal(rows.length, 3);
    assert(rows.every((row) => row.relrowsecurity));
    for (const role of ["anon", "authenticated"]) {
      const [row] = await connection`select has_schema_privilege(${role},'private','usage') as private_access,
        has_table_privilege(${role},'public.reading_requests','insert') as request_insert,
        has_table_privilege(${role},'public.orders','update') as order_update,
        has_table_privilege(${role},'public.readings','insert') as result_insert`;
      assert(Object.values(row).every((value) => value === false));
    }
    await connection.begin(async (tx) => {
      await tx`set transaction read only`;
      await tx`set local role service_role`;
      await tx`select id from public.reading_requests limit 0`;
      await tx`select version from private.active_catalog limit 0`;
    });
  });
  await check("active_catalog_integrity", async () => {
    const [row] = await connection`select c.status,count(e.id)::int as total,
      count(*) filter(where e.entry->>'meaningStatus'='unavailable')::int as missing_meanings,
      count(*) filter(where jsonb_typeof(e.entry)<>'object' or jsonb_typeof(e.entry->'dictionaryStrokes') is distinct from 'number' or e.entry->>'strokeBasis' is distinct from 'written')::int as invalid
      from private.active_catalog a join private.catalogs c on c.version=a.version
      join private.catalog_entries e on e.version=c.version group by c.status`;
    assert(row && row.total > 0 && row.invalid === 0);
    if (row.status !== "verified") blockers.push("catalog_review_incomplete");
    if (row.missing_meanings > 0) blockers.push(`catalog_missing_meanings:${row.missing_meanings}`);
  });
  await check("stored_json_objects", async () => {
    for (const [table, column] of [["private.previews", "result"], ["public.reading_requests", "input"], ["private.order_snapshots", "snapshot"], ["public.readings", "content"]]) {
      const [row] = await connection.unsafe(`select count(*)::int as invalid from ${table} where jsonb_typeof(${column}) is distinct from 'object'`);
      assert.equal(row.invalid, 0);
    }
  });
} else {
  checks.push({ name: "database_configured", ok: false });
}
await sql?.end();

if (!process.env.SAZU_API_KEY?.trim()) blockers.push("sazu_key_missing");
else if (process.env.SAZU_API_KEY.trim().startsWith("sazu_free_")) blockers.push("sazu_sample_key_only");
if (!process.env.OPENAI_API_KEY?.trim() || !process.env.OPENAI_MODEL?.trim()) blockers.push("generation_key_or_model_missing");
if (process.env.PREVIEW_ENABLED !== "true") blockers.push("preview_disabled");
// 이 명령은 실제 계정 로그인/공급자 품질/보관 정책에 대한 사람의 인수를 판정하지 않습니다.
blockers.push("payment_provider_not_implemented", "generation_schedule_pending", "manual_release_acceptance_required");
const report = { checkedAt: new Date().toISOString(), checks, releaseBlockers: blockers, technicalChecksPassed: checks.every((item) => item.ok), releaseReady: false };
await mkdir(".local/verification", { recursive: true });
await writeFile(".local/verification/operations.json", JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
console.log(JSON.stringify(report, null, 2));
if (!report.technicalChecksPassed || process.argv.includes("--release")) process.exitCode = 1;
