/**
 * Generates plausible placeholder designs so the gallery can be developed and
 * demoed before the real archive is ingested. Overwritten by `npm run index`
 * once real tags exist.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const tax = JSON.parse(readFileSync(new URL("../taxonomy/taxonomy.json", import.meta.url)));
const byFacet = (f) => tax.terms.filter((t) => t.facet === f);
const leaves = (f) => {
  const parents = new Set(tax.terms.flatMap((t) => t.parents));
  return byFacet(f).filter((t) => !parents.has(t.id));
};

// Deterministic PRNG so the sample set is stable across runs.
let seed = 20260819;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const pickN = (arr, n) => {
  const out = new Set();
  const want = Math.min(n, arr.length);
  while (out.size < want) out.add(pick(arr).id);
  return [...out];
};

// Weighted to mirror the real archive's folder distribution, so the sample
// behaves like the finished thing rather than a uniform spread.
const RECIPES = [
  { w: 456, technique: ["minimal"], form: "real-form", colour: "black-and-grey", format: ["small"], mood: ["elegant", "calm"] },
  { w: 274, technique: ["minimal"], form: "freeform", colour: "black-and-grey", format: ["micro", "filler"], mood: ["whimsical"] },
  { w: 195, technique: ["line-work"], form: "freeform", colour: "black-and-grey", format: ["vertical"], mood: ["romantic"] },
  { w: 170, technique: ["line-work"], form: "real-form", colour: "black-and-grey", format: ["medium"], mood: ["botanical-mood"] },
  { w: 164, technique: ["dot-work"], form: "freeform", colour: "black-and-grey", format: ["circular", "symmetrical"], mood: ["occult-mood"] },
  { w: 107, technique: ["minimal", "solid"], form: "real-form", colour: "solid-black-colour", format: ["small"], mood: ["bold-mood"] },
  { w: 98, technique: ["dot-work"], form: "real-form", colour: "black-and-grey", format: ["medium"], mood: ["memento-mori"] },
  { w: 78, technique: ["minimal", "solid"], form: "freeform", colour: "solid-black-colour", format: ["micro"], mood: ["bold-mood"] },
  { w: 200, technique: ["mandala-technique"], form: null, colour: "black-and-grey", format: ["circular", "symmetrical"], mood: ["calm", "elegant"] },
  { w: 54, technique: ["inverted"], form: null, colour: "solid-black-colour", format: ["medium"], mood: ["dark-mood"] },
  { w: 37, technique: ["dot-by-dot"], form: null, colour: "black-and-grey", format: ["small"], mood: ["calm"] },
  { w: 28, technique: ["three-d"], form: null, colour: "black-and-grey", format: ["medium"], mood: ["anatomical-mood"] },
];
const WEIGHTED = RECIPES.flatMap((r) => Array(Math.round(r.w / 10)).fill(r));

const subjects = leaves("subject");
const placements = byFacet("placement");
const STATUS = ["available", "available", "available", "available", "one-off"];

const designs = [];
for (let i = 1; i <= 144; i++) {
  const r = WEIGHTED[Math.floor(rnd() * WEIGHTED.length)];
  const id = `MEIA-${String(i).padStart(4, "0")}`;
  const portrait = rnd() > 0.35;
  designs.push({
    id,
    file: `${id}.jpg`,
    thumb: "",
    w: portrait ? 600 : 800,
    h: portrait ? 800 : 600,
    tags: {
      subject: pickN(subjects, 1 + Math.floor(rnd() * 3)),
      technique: r.technique,
      form: r.form ? [r.form] : [],
      colour: [r.colour],
      placement: rnd() > 0.4 ? pickN(placements, 1) : [],
      format: r.format,
      mood: r.mood,
    },
    status: STATUS[Math.floor(rnd() * STATUS.length)],
  });
}

mkdirSync(new URL("../public/", import.meta.url), { recursive: true });
writeFileSync(
  new URL("../public/designs.json", import.meta.url),
  JSON.stringify({ version: 1, sample: true, designs }, null, 2) + "\n",
);
console.log(`wrote ${designs.length} sample designs -> public/designs.json`);
