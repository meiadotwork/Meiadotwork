/**
 * Step 3: auto-tag every design against the controlled vocabulary.
 *
 *   node scripts/tag.mjs --limit 25 --sync   # trial run, results immediately
 *   node scripts/tag.mjs                      # full run via the Batch API (50% cheaper)
 *   node scripts/tag.mjs --resume BATCH_ID    # collect a batch submitted earlier
 *
 * Options: --model, --effort low|medium|high, --limit N, --sync, --force
 *
 * Already-tagged designs are skipped unless --force, so the script is safe to
 * re-run. Model output is mapped back onto canonical term ids, so a stray
 * "Knife" becomes `dagger` rather than an unsearchable tag.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { FACETS, resolveTerm, vocabularyPrompt } from "./vocab.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const DATA = path.join(ROOT, "data");
const TAGS = path.join(DATA, "tags.json");

const arg = (n, d = null) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 && process.argv[i + 1]?.startsWith("--") === false
    ? process.argv[i + 1]
    : d;
};
const flag = (n) => process.argv.includes(`--${n}`);

const MODEL = arg("model", "claude-opus-5");
const EFFORT = arg("effort", "medium");
const LIMIT = arg("limit") ? Number(arg("limit")) : Infinity;

const TagSchema = z.object({
  description: z.string(),
  subject: z.array(z.string()),
  style: z.array(z.string()),
  colour: z.string(),
  placement: z.array(z.string()),
  format: z.array(z.string()),
  mood: z.array(z.string()),
  confidence: z.enum(["high", "medium", "low"]),
});

const INSTRUCTIONS = `You are cataloguing a tattoo artist's archive of original designs so \
clients can search it. For each image, return tags drawn from the controlled vocabulary below.

Rules:
- Use ONLY term ids from the vocabulary. Never invent a term.
- Tag the MOST SPECIFIC subject that applies. Parents are added automatically, so
  tag "swallow" rather than "bird"; tag both only if two distinct birds appear.
- Tag every distinct subject element you can see, not just the main one.
- style: 1-3 terms. colour: exactly one. mood: 1-3 terms.
- placement: only when the shape or proportions clearly imply a body location.
  Leave it empty otherwise. Do not guess.
- description: one short factual sentence a client might search with. No flourish.
- confidence: "low" if the image is unclear, a photo of a page, or hard to read.

Terms marked <parent> sit under that parent. Bracketed words are synonyms — they
are alternate spellings, NOT separate terms to return.`;

const VOCAB = vocabularyPrompt();

function loadManifest() {
  const p = path.join(DATA, "manifest.json");
  if (!existsSync(p)) {
    console.error("No data/manifest.json — run `node scripts/ingest.mjs` first.");
    process.exit(1);
  }
  return JSON.parse(readFileSync(p, "utf8"));
}

const loadTags = () =>
  existsSync(TAGS) ? JSON.parse(readFileSync(TAGS, "utf8")) : {};

function saveTags(tags) {
  mkdirSync(DATA, { recursive: true });
  writeFileSync(TAGS, JSON.stringify(tags, null, 2) + "\n");
}

function buildParams(design) {
  const file = path.join(ROOT, "public", "thumbs", `${design.id}.webp`);
  const data = readFileSync(file).toString("base64");
  return {
    model: MODEL,
    max_tokens: 4000,
    system: [
      { type: "text", text: INSTRUCTIONS },
      // Stable across every request => cached, so it is billed once not 3000 times.
      { type: "text", text: VOCAB, cache_control: { type: "ephemeral" } },
    ],
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/webp", data } },
          { type: "text", text: "Catalogue this design." },
        ],
      },
    ],
    output_config: { effort: EFFORT, format: zodOutputFormat(TagSchema) },
  };
}

/** Map raw model strings onto canonical ids, collecting anything unknown. */
function canonicalise(raw, unmapped) {
  const tags = {};
  for (const facet of FACETS) {
    const value = raw[facet];
    const list = Array.isArray(value) ? value : value ? [value] : [];
    const ids = [];
    for (const v of list) {
      const id = resolveTerm(v, facet);
      if (id) {
        if (!ids.includes(id)) ids.push(id);
      } else {
        unmapped.set(`${facet}:${v}`, (unmapped.get(`${facet}:${v}`) ?? 0) + 1);
      }
    }
    tags[facet] = ids;
  }
  return tags;
}

function record(tags, id, raw, unmapped) {
  tags[id] = {
    tags: canonicalise(raw, unmapped),
    description: raw.description ?? "",
    confidence: raw.confidence ?? "medium",
    reviewed: false,
  };
}

function writeReviewCsv(manifest, tags) {
  const head = ["id", "thumb", "description", "confidence", ...FACETS, "status", "reviewed"];
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = manifest
    .filter((d) => tags[d.id])
    .map((d) => {
      const t = tags[d.id];
      return [
        d.id, d.thumb, t.description, t.confidence,
        ...FACETS.map((f) => (t.tags[f] ?? []).join(" ")),
        t.status ?? "available", t.reviewed ? "yes" : "",
      ].map(esc).join(",");
    });
  writeFileSync(path.join(DATA, "review.csv"), [head.join(","), ...rows].join("\n") + "\n");
}

function report(tags, manifest, unmapped) {
  saveTags(tags);
  writeReviewCsv(manifest, tags);
  const done = Object.keys(tags).length;
  const low = Object.values(tags).filter((t) => t.confidence === "low").length;
  console.log(`\ntagged ${done}/${manifest.length}  (${low} low-confidence)`);
  if (unmapped.size) {
    console.log(`\n${unmapped.size} terms the model used that are not in the vocabulary:`);
    [...unmapped.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
      .forEach(([k, n]) => console.log(`  ${n}×  ${k}`));
    console.log("Consider adding the frequent ones to taxonomy/taxonomy.json.");
  }
  console.log(`\ntags   -> data/tags.json`);
  console.log(`review -> data/review.csv   (edit, then: node scripts/build-index.mjs)`);
}

async function main() {
  const client = new Anthropic();
  const manifest = loadManifest();
  const tags = loadTags();
  const unmapped = new Map();

  const resumeId = arg("resume");
  if (resumeId) {
    console.log(`collecting batch ${resumeId}…`);
    await collect(client, resumeId, tags, unmapped);
    return report(tags, manifest, unmapped);
  }

  const todo = manifest
    .filter((d) => flag("force") || !tags[d.id])
    .slice(0, LIMIT);

  if (!todo.length) {
    console.log("Nothing to tag. Use --force to re-tag.");
    return;
  }
  console.log(`tagging ${todo.length} designs with ${MODEL} (effort: ${EFFORT})`);

  if (flag("sync")) {
    for (const [i, d] of todo.entries()) {
      const res = await client.messages.parse(buildParams(d));
      if (res.parsed_output) record(tags, d.id, res.parsed_output, unmapped);
      else console.warn(`  ! ${d.id}: could not parse output`);
      if ((i + 1) % 10 === 0 || i === todo.length - 1) {
        console.log(`  ${i + 1}/${todo.length}`);
        saveTags(tags);
      }
    }
    return report(tags, manifest, unmapped);
  }

  const batch = await client.messages.batches.create({
    requests: todo.map((d) => ({ custom_id: d.id, params: buildParams(d) })),
  });
  console.log(`batch ${batch.id} submitted (${todo.length} requests)`);
  console.log(`most finish within an hour; safe to stop and later run:`);
  console.log(`  node scripts/tag.mjs --resume ${batch.id}\n`);

  let status = batch;
  while (status.processing_status !== "ended") {
    await new Promise((r) => setTimeout(r, 30_000));
    status = await client.messages.batches.retrieve(batch.id);
    const c = status.request_counts;
    console.log(`  ${status.processing_status} — done ${c.succeeded}, failed ${c.errored}`);
  }
  await collect(client, batch.id, tags, unmapped);
  report(tags, manifest, unmapped);
}

async function collect(client, batchId, tags, unmapped) {
  let ok = 0;
  let bad = 0;
  for await (const r of await client.messages.batches.results(batchId)) {
    if (r.result.type !== "succeeded") {
      bad++;
      console.warn(`  ! ${r.custom_id}: ${r.result.type}`);
      continue;
    }
    const text = r.result.message.content.find((b) => b.type === "text")?.text;
    if (!text) { bad++; continue; }
    try {
      record(tags, r.custom_id, JSON.parse(text), unmapped);
      ok++;
    } catch {
      bad++;
      console.warn(`  ! ${r.custom_id}: unparseable JSON`);
    }
  }
  console.log(`collected ${ok} results${bad ? `, ${bad} failed` : ""}`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
