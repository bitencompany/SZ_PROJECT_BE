import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const root = ".local/hanja-replacement";
const sources = [
  { repository: "libhangul/libhangul", commit: "23d2cd9d10d516d523d60c562dbcc7ea08139a09", files: ["data/hanja/hanja.txt"] },
  { repository: "rutopio/Korean-Name-Hanja-Charset", commit: "12df1ba1b4dfaa095813e4ddfba424e816f94c53", files: ["data-gov.csv", "LICENSE"] },
];
const written = JSON.parse(await readFile("src/data/written-strokes.json", "utf8"));
await mkdir(root, { recursive: true });
async function download(url, file, expectedHash) {
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`SOURCE_HTTP_${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length > 20_000_000) throw new Error("SOURCE_SIZE_LIMIT");
  const hash = createHash("sha256").update(data).digest("hex");
  if (expectedHash && hash !== expectedHash) throw new Error("SOURCE_HASH_MISMATCH");
  await writeFile(`${root}/${file}`, data);
  return hash;
}
for (const source of sources) {
  const name = source.repository.split("/")[1];
  const manifest = { repository: source.repository, commit: source.commit, files: {}, hashes: {} };
  for (const file of source.files) {
    const url = `https://raw.githubusercontent.com/${source.repository}/${source.commit}/${file}`;
    const destination = `${name}-${file.split("/").pop()}`;
    manifest.hashes[destination] = await download(url, destination);
    manifest.files[destination] = url;
  }
  await writeFile(`${root}/${name}-source.json`, JSON.stringify(manifest, null, 2) + "\n");
}
await download(written.source, "Unihan.zip", written.sha256);
console.log("고정 버전 한자 v2 원본 다운로드 완료. npm run catalog:build로 검증·변환하세요.");
