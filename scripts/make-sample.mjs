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

// Coherent style/colour/mood pairings, so the sample behaves like a real archive.
const RECIPES = [
  { style: ["fine-line"], colour: "black-and-grey", format: ["small", "vertical"], mood: ["elegant", "feminine"] },
  { style: ["fine-line", "dotwork"], colour: "black-and-grey", format: ["micro", "filler"], mood: ["minimal-mood"] },
  { style: ["dotwork", "ornamental"], colour: "black-and-grey", format: ["circular", "symmetrical"], mood: ["occult", "elegant"] },
  { style: ["traditional"], colour: "full-colour", format: ["medium"], mood: ["nautical", "bold"] },
  { style: ["neo-traditional"], colour: "full-colour", format: ["large"], mood: ["romantic", "vintage"] },
  { style: ["blackwork"], colour: "solid-black", format: ["large", "band"], mood: ["dark", "bold"] },
  { style: ["engraving", "linework"], colour: "black-and-grey", format: ["vertical"], mood: ["vintage", "macabre"] },
  { style: ["illustrative", "linework"], colour: "red-accent", format: ["medium"], mood: ["whimsical"] },
  { style: ["japanese"], colour: "full-colour", format: ["full-piece"], mood: ["mythology", "bold"] },
  { style: ["geometric", "dotwork"], colour: "black-and-grey", format: ["symmetrical", "circular"], mood: ["celestial-theme"] },
  { style: ["sketch"], colour: "black-and-grey", format: ["small"], mood: ["romantic"] },
  { style: ["art-nouveau", "ornamental"], colour: "limited-palette", format: ["vertical", "large"], mood: ["elegant", "botanical"] },
];

const subjects = leaves("subject");
const placements = byFacet("placement");
const STATUS = ["available", "available", "available", "repeatable", "one-off"];

const designs = [];
for (let i = 1; i <= 144; i++) {
  const r = RECIPES[Math.floor(rnd() * RECIPES.length)];
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
      style: r.style,
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
