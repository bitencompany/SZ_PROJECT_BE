import postgres from "postgres";
import { readFile } from "node:fs/promises";
import { catalogImportSchema } from "../src/lib/backend/catalog";
const path = process.argv.find((arg, i) => i > 1 && !arg.startsWith("--"));
if (!path) {
  console.error(
    "사용법: npm run catalog:import -- /path/catalog.json [--activate]",
  );
  process.exit(1);
}
const activate = process.argv.includes("--activate");
let sql: postgres.Sql | undefined;
try {
  const catalog = catalogImportSchema.parse(
    JSON.parse(await readFile(path, "utf8")),
  );
  if (!process.env.DATABASE_URL) throw new Error("NOT_CONFIGURED");
  sql = postgres(process.env.DATABASE_URL, {
    max: 1,
    prepare: false,
    onnotice: () => {},
  });
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(301720261031)`;
    await tx`insert into private.catalogs(version,status,metadata) values(${catalog.catalog.version},${catalog.catalog.status},${tx.json(catalog.metadata)})`;
    for (let i = 0; i < catalog.entries.length; i += 250) {
      const batch = catalog.entries.slice(i, i + 250).map((item) => ({
        id: item.entry.id,
        reading: item.entry.reading,
        entry: item.entry,
        evidence: item.evidence,
      }));
      await tx`insert into private.catalog_entries(version,id,reading,entry,evidence)
        select ${catalog.catalog.version},x.id,x.reading,x.entry,x.evidence
        from jsonb_to_recordset(${tx.json(batch)}::jsonb) as x(id text,reading text,entry jsonb,evidence jsonb)`;
    }
    if (activate)
      await tx`insert into private.active_catalog(singleton,version) values(true,${catalog.catalog.version}) on conflict(singleton) do update set version=excluded.version`;
  });
  console.log(
    `카탈로그 ${catalog.catalog.version}: ${catalog.entries.length}개 반입${activate ? ", 활성화" : ""}`,
  );
} catch {
  console.error(
    "반입 실패: JSON 스키마/검수 근거/중복 버전/DB 설정을 확인하세요. 데이터 원문은 출력하지 않습니다.",
  );
  process.exitCode = 1;
} finally {
  await sql?.end();
}
