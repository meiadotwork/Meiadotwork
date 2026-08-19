/**
 * Step 5: merge manifest + tags (+ your reviewed CSV) into the single file the
 * website loads.
 *
 *   node scripts/build-index.mjs
 *   node scripts/build-index.mjs --only-reviewed   # publish only rows you've checked
 *
 * data/review.csv wins over data/tags.json wherever both exist, so editing the
 * spreadsheet is enough — no need to touch JSON.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { FACETS, resolveTerm } from "./vocab.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const DATA = path.join(ROOT, "data");
const flag = (n) => process.argv.includes(`--${n}`);

/** Minimal RFC4180 reader — handles quoted fields containing commas. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((v) => v !== ""));
}

function readReview() {
  const p = path.join(DATA, "review.csv");
  if (!existsSync(p)) return {};
  const [head, ...rows] = parseCsv(readFileSync(p, "utf8"));
  const col = (name) => head.indexOf(name);
  const out = {};
  const problems = [];

  for (const r of rows) {
    const id = r[col("id")];
    if (!id) continue;
    const tags = {};
    for (const facet of FACETS) {
      const i = col(facet);
      const words = i > -1 ? (r[i] ?? "").split(/\s+/).filter(Boolean) : [];
      tags[facet] = words
        .map((w) => {
          const resolved = resolveTerm(w, facet);
          if (!resolved) problems.push(`${id}: "${w}" is not a valid ${facet} term`);
          return resolved;
        })
        .filter(Boolean);
    }
    out[id] = {
      tags,
      description: col("description") > -1 ? r[col("description")] : "",
      confidence: col("confidence") > -1 ? r[col("confidence")] : "medium",
      status: (col("status") > -1 && r[col("status")]) || "available",
      reviewed: col("reviewed") > -1 && r[col("reviewed")].trim() !== "",
    };
  }
  if (problems.length) {
    console.warn(`\n${problems.length} unrecognised terms in review.csv:`);
    problems.slice(0, 20).forEach((p) => console.warn(`  ${p}`));
    console.warn("These were dropped. Fix the spelling or add the term to the taxonomy.\n");
  }
  return out;
}

const manifestPath = path.join(DATA, "manifest.json");
if (!existsSync(manifestPath)) {
  console.error("No data/manifest.json — run `node scripts/ingest.mjs` first.");
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const tagsPath = path.join(DATA, "tags.json");
const autoTags = existsSync(tagsPath) ? JSON.parse(readFileSync(tagsPath, "utf8")) : {};
const review = readReview();

const designs = [];
let untagged = 0;
let reviewed = 0;

for (const m of manifest) {
  const t = review[m.id] ?? autoTags[m.id];
  if (!t) { untagged++; continue; }
  if (t.reviewed) reviewed++;
  if (flag("only-reviewed") && !t.reviewed) continue;

  const tags = {};
  for (const f of FACETS) if (t.tags[f]?.length) tags[f] = t.tags[f];

  designs.push({
    id: m.id,
    file: m.file,
    thumb: m.thumb,
    w: m.w,
    h: m.h,
    tags,
    notes: t.description || undefined,
    status: t.status || "available",
  });
}

writeFileSync(
  path.join(ROOT, "public", "designs.json"),
  JSON.stringify({ version: 1, generated: new Date().toISOString(), designs }, null, 2) + "\n",
);

const kb = (JSON.stringify(designs).length / 1024).toFixed(0);
console.log(`published ${designs.length} designs -> public/designs.json (${kb} KB)`);
console.log(`  reviewed by hand: ${reviewed}`);
if (untagged) console.log(`  still untagged:   ${untagged}`);
console.log(`\nnext: npm run build`);
