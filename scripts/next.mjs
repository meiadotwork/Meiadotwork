/**
 * Lists the next untagged publishable designs so they can be reviewed and
 * tagged in batches:
 *
 *   node scripts/next.mjs 9              # next 9, any folder
 *   node scripts/next.mjs 9 "3D-28"      # next 9 inside a folder
 *
 * Prints the thumbnail path for each so the images can be opened directly,
 * plus a per-folder count of what is still untagged.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const N = Number(process.argv[2] || 9);
const FILTER = process.argv[3] || "";

const manifest = JSON.parse(
  readFileSync(path.join(ROOT, "data/manifest.json"), "utf8"),
);
const tagsPath = path.join(ROOT, "data/tags.json");
const tags = existsSync(tagsPath) ? JSON.parse(readFileSync(tagsPath, "utf8")) : {};

const untagged = manifest.filter(
  (m) => m.publish !== false && !tags[m.id],
);

const byFolder = new Map();
for (const m of untagged) {
  const dir = path.dirname(m.file);
  byFolder.set(dir, (byFolder.get(dir) || 0) + 1);
}

const batch = untagged
  .filter((m) => (FILTER ? m.file.startsWith(FILTER) : true))
  .slice(0, N);

for (const m of batch) {
  const bits = [...m.technique, ...m.form].join(" ") || "-";
  console.log(`${m.id}  ${bits}  ${m.file}`);
}
console.log("");
for (const [dir, n] of [...byFolder].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)}  ${dir}`);
}
console.log(`\n  ${untagged.length} untagged of ${manifest.filter((m) => m.publish !== false).length} publishable`);
console.log(batch.map((m) => path.join(ROOT, "public", m.thumb)).join("\n"));
