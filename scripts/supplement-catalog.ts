import { readFile, writeFile } from "node:fs/promises";
import { supplementGangCatalog } from "../src/lib/backend/catalog-supplements";

const input = process.argv[2] ?? ".local/hanja/catalog.json";
const output = process.argv[3] ?? ".local/hanja/catalog-gang.json";
const catalog = supplementGangCatalog(
  JSON.parse(await readFile(input, "utf8")),
);
await writeFile(output, JSON.stringify(catalog, null, 2) + "\n");
console.log(
  JSON.stringify({
    output,
    version: catalog.catalog.version,
    entries: catalog.entries.length,
    added: ["姜", "康", "江"],
  }),
);
