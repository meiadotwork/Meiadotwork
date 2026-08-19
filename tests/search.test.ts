import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIndex, runQuery, matchesSelection, type Design } from "../lib/search.ts";
import { ancestors, descendants, resolvePhrase, rootTerms } from "../lib/taxonomy.ts";

const d = (id: string, tags: Design["tags"], extra: Partial<Design> = {}): Design => ({
  id, file: `${id}.jpg`, thumb: `/thumbs/${id}.webp`, w: 600, h: 800, tags, ...extra,
});

const designs: Design[] = [
  d("A", { subject: ["swallow"], style: ["fine-line"], colour: ["black-and-grey"] }),
  d("B", { subject: ["dagger", "rose"], style: ["traditional"], colour: ["full-colour"] }),
  d("C", { subject: ["peony"], style: ["dotwork"], colour: ["black-and-grey"] }),
  d("D", { subject: ["butterfly"], style: ["linework"], colour: ["black-and-grey"] }),
  d("E", { subject: ["crow"], style: ["blackwork"], colour: ["solid-black"] }),
];
const index = buildIndex(designs);
const ids = (q: string, selection = {}) =>
  runQuery(designs, index, { query: q, selection }).map((x) => x.id).sort();

test("hierarchy: swallow and crow roll up to bird", () => {
  assert.ok(ancestors("swallow").includes("bird"));
  assert.ok(descendants("bird").includes("crow"));
  // but a generic bird is not a specific swallow
  assert.ok(!ancestors("bird").includes("swallow"));
});

test("searching a parent finds designs tagged with a child", () => {
  assert.deepEqual(ids("bird"), ["A", "E"]);
});

test("synonyms resolve: knife -> dagger, sakura -> cherry-blossom", () => {
  assert.deepEqual(ids("knife"), ["B"]);
  assert.deepEqual(resolvePhrase("sakura"), ["cherry-blossom"]);
  assert.deepEqual(resolvePhrase("black and gray"), ["black-and-grey"]);
});

test("style terms are searchable in their spaced form", () => {
  assert.deepEqual(ids("line work"), ["D"]);
  assert.deepEqual(ids("dot work"), ["C"]);
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

test("chips filter, and combine across facets with AND", () => {
  assert.deepEqual(ids("", { colour: ["black-and-grey"] }), ["A", "C", "D"]);
  assert.deepEqual(ids("", { colour: ["black-and-grey"], style: ["dotwork"] }), ["C"]);
});

test("a parent chip matches children", () => {
  assert.ok(matchesSelection(designs[0], { subject: ["bird"] }));
  assert.ok(!matchesSelection(designs[2], { subject: ["bird"] }));
});

test("text and chips compose", () => {
  assert.deepEqual(ids("bird", { colour: ["black-and-grey"] }), ["A"]);
});

test("empty query returns everything in source order", () => {
  assert.equal(runQuery(designs, index, { query: "", selection: {} }).length, 5);
});

test("subject roots are a usable number of chips", () => {
  const roots = rootTerms("subject");
  assert.ok(roots.length > 10 && roots.length < 30, `got ${roots.length}`);
});
