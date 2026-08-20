/**
 * Merge hand-written tags into data/tags.json, validating every term against
 * the vocabulary. Reads compact JSON on stdin:
 *
 *   { "MEIA-xxxx": { "s": ["rose"], "c": "black-and-grey",
 *                    "f": ["vertical"], "m": ["elegant"], "d": "A rose." } }
 *
 * Refuses the whole batch if any term is unknown, so a typo can never land a
 * design under a tag nothing will ever search for.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveTerm } from "./vocab.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const TAGS = path.join(ROOT, "data", "tags.json");

const input = JSON.parse(readFileSync(0, "utf8"));
const out = JSON.parse(readFileSync(TAGS, "utf8"));
const known = new Set(JSON.parse(readFileSync(path.join(ROOT, "data", "manifest.json"), "utf8")).map((r) => r.id));

const problems = [];
let added = 0;
let replaced = 0;

for (const [id, t] of Object.entries(input)) {
  if (!known.has(id)) { problems.push(`${id}: not in the manifest`); continue; }
  const tags = { subject: [], colour: [], placement: [], format: [], mood: [] };
  const put = (list, facet) => {
    for (const raw of list ?? []) {
      const r = resolveTerm(raw, facet);
      if (r) { if (!tags[facet].includes(r)) tags[facet].push(r); }
      else problems.push(`${id}: "${raw}" is not a valid ${facet} term`);
    }
  };
  put(t.s, "subject");
  put(t.c ? [t.c] : [], "colour");
  put(t.p, "placement");
  put(t.f, "format");
  put(t.m, "mood");
  if (!tags.subject.length) problems.push(`${id}: no valid subject`);
  // "d" is a free-text description. A list here means a facet was meant, and
  // silently stringifying it would put junk into the search index.
  if (t.d != null && typeof t.d !== "string") {
    problems.push(`${id}: "d" must be a description string, not ${JSON.stringify(t.d)}`);
  }
  if (out[id]) replaced++; else added++;
  out[id] = { tags, description: t.d ?? "", confidence: t.conf ?? "high", reviewed: true };
}

if (problems.length) {
  console.error(`REJECTED — ${problems.length} problem(s), nothing written:`);
  problems.forEach((p) => console.error("  " + p));
  process.exit(1);
}

writeFileSync(TAGS, JSON.stringify(out, null, 2) + "\n");
const total = Object.keys(out).length;
const pub = JSON.parse(readFileSync(path.join(ROOT, "data", "manifest.json"), "utf8")).filter((r) => r.publish).length;
console.log(`+${added} new${replaced ? `, ${replaced} updated` : ""} — ${total} of ${pub} publishable tagged (${Math.round((total / pub) * 100)}%)`);
