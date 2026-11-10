import { readFile, writeFile } from "node:fs/promises";
import { buildHanjaV2 } from "../src/lib/backend/catalog-v2";

const root = ".local/hanja-replacement";
const { catalog, report } = buildHanjaV2(
  JSON.parse(await readFile(`${root}/prepared.json`, "utf8")),
  JSON.parse(await readFile(".local/hanja/catalog-gang.json", "utf8")),
);
await writeFile(`${root}/catalog-v2.json`, JSON.stringify(catalog, null, 2) + "\n");
await writeFile(`${root}/migration-report.json`, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ ...report, changedMeanings: report.changedMeanings.length }));

// Keep the offline FE examples on the same dictionary pipeline; their IDs stay stable.
// BE-only verification must not write into a separately edited FE checkout.
if (!process.argv.includes("--skip-fe")) {
const examples: { reading: string; character: string }[] = JSON.parse(await readFile("../SZ_PROJECT_FE/src/data/hanja-example-ids.json", "utf8"));
const seed = examples.map(({ reading, character }) => {
  const entry = catalog.entries.find(({ entry }) => entry.reading === reading && entry.character === character)?.entry;
  if (!entry) throw new Error(`EXAMPLE_PAIR_NOT_FOUND: ${reading}/${character}`);
  return { ...entry, id: `${reading}-${character}` };
});
await writeFile("../SZ_PROJECT_FE/src/data/hanja-examples.json", JSON.stringify(seed, null, 2) + "\n");
for (const name of ["LIBHANGUL-DATA-LICENSE.txt", "COURT-SNAPSHOT-LICENSE.txt"])
  await writeFile(`../SZ_PROJECT_FE/src/data/${name}`, await readFile(`src/data/${name}`));
}
