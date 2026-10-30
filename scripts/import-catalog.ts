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
    for (const item of catalog.entries)
      await tx`insert into private.catalog_entries(version,id,reading,entry,evidence) values(${catalog.catalog.version},${item.entry.id},${item.entry.reading},${tx.json(item.entry)},${tx.json(item.evidence)})`;
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
