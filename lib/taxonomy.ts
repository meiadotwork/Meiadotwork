import raw from "../taxonomy/taxonomy.json";

export type FacetId =
  | "subject" | "technique" | "form" | "colour" | "placement" | "format" | "mood";

export interface Term {
  id: string;
  label: string;
  facet: FacetId;
  /** 1 = group, 2 = kind, 3 = specific. Subject only; null elsewhere. */
  level: number | null;
  parents: string[];
  synonyms: string[];
}

export interface Facet {
  id: FacetId;
  label: string;
  multi: boolean;
  required: boolean;
  /** "folder" tags come from the archive path; "model" tags from the image. */
  source: "folder" | "model";
  note?: string;
}

export interface Taxonomy {
  version: number;
  updated: string;
  note: string;
  facets: Facet[];
  terms: Term[];
}

export const taxonomy = raw as unknown as Taxonomy;

export const FACET_ORDER: FacetId[] = [
  "subject", "technique", "form", "colour", "placement", "format", "mood",
];

/** Lowercase, punctuation to spaces, collapse runs. "Black-and-Grey" -> "black and grey" */
export function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export const byId = new Map<string, Term>(taxonomy.terms.map((t) => [t.id, t]));

export const facetById = new Map<FacetId, Facet>(
  taxonomy.facets.map((f) => [f.id, f]),
);

/** Direct children, derived from each term's declared parents. */
const childrenOf = new Map<string, string[]>();
for (const t of taxonomy.terms) {
  for (const p of t.parents) {
    const list = childrenOf.get(p);
    if (list) list.push(t.id);
    else childrenOf.set(p, [t.id]);
  }
}

function walk(start: string, edges: (id: string) => string[]): string[] {
  const seen = new Set<string>();
  const stack = [...edges(start)];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue; // cycle-safe
    seen.add(id);
    stack.push(...edges(id));
  }
  return [...seen];
}

const ancestorCache = new Map<string, string[]>();
/** All transitive parents. `swallow` -> ["bird"] */
export function ancestors(id: string): string[] {
  let hit = ancestorCache.get(id);
  if (!hit) {
    hit = walk(id, (x) => byId.get(x)?.parents ?? []);
    ancestorCache.set(id, hit);
  }
  return hit;
}

const descendantCache = new Map<string, string[]>();
/** All transitive children. `bird` -> ["swallow", "crow", ...] */
export function descendants(id: string): string[] {
  let hit = descendantCache.get(id);
  if (!hit) {
    hit = walk(id, (x) => childrenOf.get(x) ?? []);
    descendantCache.set(id, hit);
  }
  return hit;
}

/** A tag plus everything it implies. Tagging `swallow` implies `bird`. */
export function withAncestors(ids: string[]): string[] {
  const out = new Set<string>();
  for (const id of ids) {
    out.add(id);
    for (const a of ancestors(id)) out.add(a);
  }
  return [...out];
}

/**
 * Every phrase that should resolve to a term: its id, its label and its
 * synonyms, all normalised. Ambiguous phrases map to several terms, so the
 * value is a list rather than a single id.
 */
export const phraseIndex = (() => {
  const m = new Map<string, string[]>();
  const add = (phrase: string, id: string) => {
    const k = normalise(phrase);
    if (!k) return;
    const list = m.get(k);
    if (!list) m.set(k, [id]);
    else if (!list.includes(id)) list.push(id);
  };
  for (const t of taxonomy.terms) {
    add(t.id, t.id);
    add(t.label, t.id);
    for (const s of t.synonyms) add(s, t.id);
  }
  return m;
})();

/** Resolve free text to matching term ids. Exact phrase first, then per-word. */
export function resolvePhrase(text: string): string[] {
  const key = normalise(text);
  if (!key) return [];
  const exact = phraseIndex.get(key);
  if (exact) return exact;
  const out = new Set<string>();
  for (const word of key.split(" ")) {
    for (const id of phraseIndex.get(word) ?? []) out.add(id);
  }
  return [...out];
}

/** Direct children of a term, in label order. */
export function childrenOfTerm(id: string): Term[] {
  return (childrenOf.get(id) ?? [])
    .map((c) => byId.get(c))
    .filter((t): t is Term => Boolean(t))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Terms of a facet that sit at the top of the hierarchy — the chip candidates. */
export function rootTerms(facet: FacetId): Term[] {
  return taxonomy.terms
    .filter((t) => t.facet === facet && t.parents.length === 0)
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function termsOfFacet(facet: FacetId): Term[] {
  return taxonomy.terms
    .filter((t) => t.facet === facet)
    .sort((a, b) => a.label.localeCompare(b.label));
}
