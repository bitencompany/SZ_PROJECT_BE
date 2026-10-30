import postgres from "postgres";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
// 신규 DB: --apply. FE 초기 migration이 이미 적용된 DB: --adopt-fe-base --apply.
// adopt는 스키마 동등성을 자동 보증하지 않습니다. 문서의 사전 점검 후 사용하세요.
const apply = process.argv.includes("--apply");
const adopt = process.argv.includes("--adopt-fe-base");
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL 설정이 필요합니다.");
  process.exit(1);
}
const sql = postgres(process.env.DATABASE_URL, {
  max: 1,
  prepare: false,
  onnotice: () => {},
});
try {
  const files = (
    await readdir(new URL("../supabase/migrations/", import.meta.url))
  )
    .filter((f) => f.endsWith(".sql"))
    .sort();
  if (!apply) {
    console.log(
      `적용 대상: ${files.join(", ")}. 변경하려면 --apply를 지정하세요.`,
    );
  } else
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(301720261030)`;
      await tx`create schema if not exists private`;
      await tx`revoke all on schema private from public,anon,authenticated`;
      await tx`create table if not exists private.backend_migrations(name text primary key,sha256 text not null,applied_at timestamptz not null default now())`;
      for (const name of files) {
        const raw = await readFile(
          new URL(`../supabase/migrations/${name}`, import.meta.url),
          "utf8",
        );
        const hash = createHash("sha256").update(raw).digest("hex");
        const [existing] =
          await tx`select sha256 from private.backend_migrations where name=${name}`;
        if (existing) {
          if (existing.sha256 !== hash) throw new Error("MIGRATION_CHANGED");
          continue;
        }
        if (adopt && name === "202610300001_readings.sql") {
          const [tables] =
            await tx`select to_regclass('public.reading_requests') is not null and to_regclass('public.orders') is not null and to_regclass('public.readings') is not null as present`;
          if (!tables.present) throw new Error("BASE_MISSING");
        } else {
          // 전체 마이그레이션은 외부 트랜잭션 하나에서 적용합니다.
          await tx.unsafe(
            raw.replace(/^begin;\s*$/gim, "").replace(/^commit;\s*$/gim, ""),
          );
        }
        await tx`insert into private.backend_migrations(name,sha256) values(${name},${hash})`;
        console.log(
          `${name}: ${adopt && name.startsWith("202610300001") ? "기존 FE 기준 등록" : "적용"}`,
        );
      }
    });
} catch {
  console.error(
    "마이그레이션 실패: 연결/스키마/적용 이력을 확인하세요. 오류 원문은 출력하지 않습니다.",
  );
  process.exitCode = 1;
} finally {
  await sql.end();
}
