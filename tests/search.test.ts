import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIndex, runQuery, matchesSelection, type Design } from "../lib/search.ts";
import {
  ancestors, descendants, resolvePhrase, rootTerms, withAncestors, childrenOfTerm,
} from "../lib/taxonomy.ts";

const d = (id: string, tags: Design["tags"], extra: Partial<Design> = {}): Design => ({
  id, file: `${id}.jpg`, thumb: `/thumbs/${id}.webp`, w: 600, h: 800, tags, ...extra,
});

const designs: Design[] = [
  d("A", { subject: ["swallow"], technique: ["line-work"], form: ["freeform"], colour: ["black-and-grey"] }),
  d("B", { subject: ["dagger", "rose"], technique: ["minimal"], form: ["real-form"], colour: ["full-colour"] }),
  d("C", { subject: ["peony"], technique: ["dot-work"], form: ["freeform"], colour: ["black-and-grey"] }),
  d("D", { subject: ["butterfly"], technique: ["line-work"], form: ["real-form"], colour: ["black-and-grey"] }),
  d("E", { subject: ["crow"], technique: ["minimal", "solid"], form: ["real-form"], colour: ["solid-black-colour"] }),
  d("F", { subject: ["mandala"], technique: ["mandala-technique"], colour: ["black-and-grey"] }),
];
const index = buildIndex(designs);
const ids = (q: string, selection = {}) =>
  runQuery(designs, index, { query: q, selection }).map((x) => x.id).sort();

test("subject is three levels: swallow -> birds -> animals", () => {
  assert.deepEqual(withAncestors(["swallow"]).sort(), ["animals", "birds", "swallow"]);
  assert.ok(ancestors("dagger").includes("objects"));
  assert.ok(descendants("animals").includes("crow"));
});

test("searching a group finds designs tagged three levels down", () => {
  // swallow -> birds, crow -> birds, butterfly -> insects; all under animals
  assert.deepEqual(ids("animals"), ["A", "D", "E"]);
  // rose and peony both sit under flowers -> plants
  assert.deepEqual(ids("plants"), ["B", "C"]);
});

test("searching a kind finds its specific terms", () => {
  assert.deepEqual(ids("bird"), ["A", "E"]);
  assert.deepEqual(ids("flowers"), ["B", "C"]);
});

test("synonyms resolve across the vocabulary", () => {
  assert.deepEqual(ids("knife"), ["B"]);
  assert.deepEqual(resolvePhrase("sakura"), ["cherry-blossom"]);
  assert.deepEqual(resolvePhrase("black and gray"), ["black-and-grey"]);
});

test("technique is searchable in the artist's own words", () => {
  assert.deepEqual(ids("linework"), ["A", "D"]);
  assert.deepEqual(ids("dotwork"), ["C"]);
  assert.deepEqual(ids("minimalist"), ["B", "E"]);
});

test("form separates stylised from true-to-life", () => {
  assert.deepEqual(ids("", { form: ["freeform"] }), ["A", "C"]);
  assert.deepEqual(ids("", { form: ["real-form"] }), ["B", "D", "E"]);
});

test("typos still match", () => {
  assert.deepEqual(ids("buterfly"), ["D"]);
});

test("multi-word queries require every word", () => {
  assert.deepEqual(ids("rose dagger"), ["B"]);
  assert.deepEqual(ids("rose swallow"), []);
});

test("stopwords do not break an AND query", () => {
  assert.deepEqual(ids("rose and dagger"), ["B"]);
});

test("chips combine with AND across facets", () => {
  assert.deepEqual(ids("", { colour: ["black-and-grey"] }), ["A", "C", "D", "F"]);
  assert.deepEqual(
    ids("", { colour: ["black-and-grey"], technique: ["dot-work"] }),
    ["C"],
  );
});

test("a group chip matches designs tagged with a specific term", () => {
  assert.ok(matchesSelection(designs[0], { subject: ["animals"] }));
  assert.ok(!matchesSelection(designs[2], { subject: ["animals"] }));
});

test("text and chips compose", () => {
  assert.deepEqual(ids("bird", { colour: ["black-and-grey"] }), ["A"]);
});

test("mandala is reachable as a subject and as a technique", () => {
  assert.deepEqual(ids("mandala"), ["F"]);
  assert.ok(ancestors("mandala").includes("ornament"));
});

test("there are nine subject groups, each with kinds beneath it", () => {
  const groups = rootTerms("subject");
  assert.equal(groups.length, 9, `got ${groups.map((g) => g.id).join(",")}`);
  for (const g of groups) {
    assert.ok(childrenOfTerm(g.id).length > 0, `${g.id} has no kinds`);
  }
});

test("technique and form are flat — no hierarchy to roll up", () => {
  for (const facet of ["technique", "form"] as const) {
    for (const t of rootTerms(facet)) assert.equal(t.parents.length, 0);
  }
});
