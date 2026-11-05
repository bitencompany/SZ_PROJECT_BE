import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  buildSourceCatalog,
  indexUrl,
  sourceIndexSchema,
} from "../src/lib/backend/catalog-source";

const output = resolve(process.argv[2] ?? ".local/hanja");
const cache = join(output, "source-cache");
async function fetchJson(url: string) {
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(20000),
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`SOURCE_HTTP_${response.status}`);
  if (!response.headers.get("content-type")?.includes("application/json"))
    throw new Error("SOURCE_CONTENT_TYPE");
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2_000_000) throw new Error("SOURCE_SIZE_LIMIT");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
async function save(path: string, value: unknown) {
  await writeFile(`${path}.tmp`, JSON.stringify(value, null, 2) + "\n");
  await rename(`${path}.tmp`, path);
}
try {
  await mkdir(cache, { recursive: true });
  const index = sourceIndexSchema.parse(await fetchJson(indexUrl));
  const pages: unknown[] = [];
  for (const item of index.readings) {
    const key = createHash("sha256")
      .update(JSON.stringify([index.release, index.snapshot_date, item]))
      .digest("hex");
    const path = join(cache, `${key}.json`);
    let page: unknown;
    try {
      page = JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await delay(300);
      page = await fetchJson(item.data_url);
      await save(path, page);
    }
    pages.push(page);
    if (pages.length % 10 === 0)
      console.log(`한자 독음 ${pages.length}/${index.count} 확인`);
  }
  const { catalog, report } = buildSourceCatalog(
    index,
    pages,
    new Date().toISOString().slice(0, 10),
  );
  await save(join(output, "index.json"), index);
  await save(join(output, "catalog.json"), catalog);
  await save(join(output, "report.json"), report);
  console.log(JSON.stringify(report, null, 2));
  console.log(
    `개발 검증용 파일: ${join(output, "catalog.json")}. DB 반입·활성화는 별도 명령입니다.`,
  );
} catch (error) {
  console.error(
    "한자 수집 실패:",
    error instanceof Error ? error.message : "UNKNOWN",
  );
  process.exitCode = 1;
}
