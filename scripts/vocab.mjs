/** Shared vocabulary helpers for the tagging + indexing scripts. */
import { readFileSync } from "node:fs";

export const taxonomy = JSON.parse(
  readFileSync(new URL("../taxonomy/taxonomy.json", import.meta.url)),
);

export const FACETS = ["subject", "style", "colour", "placement", "format", "mood"];

export const normalise = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const byId = new Map(taxonomy.terms.map((t) => [t.id, t]));

/** Every phrase that resolves to a term id — id, label and synonyms. */
const phrase = new Map();
for (const t of taxonomy.terms) {
  for (const p of [t.id, t.label, ...t.synonyms]) {
    const k = normalise(p);
    if (!k) continue;
    if (!phrase.has(k)) phrase.set(k, []);
    if (!phrase.get(k).includes(t.id)) phrase.get(k).push(t.id);
  }
}

/**
 * Map a model-supplied string back to a canonical term id in the right facet.
 * Handles case, punctuation and synonyms, so "Knife" and "knives" land on
 * `dagger`. Returns null when nothing in the vocabulary matches.
 */
export function resolveTerm(raw, facet) {
  const k = normalise(raw);
  if (!k) return null;
  const direct = phrase.get(k) ?? [];
  const inFacet = direct.filter((id) => byId.get(id)?.facet === facet);
  if (inFacet.length) return inFacet[0];
  // Try common plural forms before giving up: knives -> knife, lilies -> lily.
  const candidates = [
    k.replace(/ves$/, "fe"),
    k.replace(/ves$/, "f"),
    k.replace(/ies$/, "y"),
    k.replace(/es$/, ""),
    k.replace(/s$/, ""),
  ];
  for (const c of candidates) {
    if (c === k) continue;
    const alt = (phrase.get(c) ?? []).filter(
      (id) => byId.get(id)?.facet === facet,
    );
    if (alt.length) return alt[0];
  }
  return null;
}

/** The vocabulary, rendered for the system prompt. Stable => cacheable. */
export function vocabularyPrompt() {
  const lines = [];
  for (const facet of FACETS) {
    const meta = taxonomy.facets.find((f) => f.id === facet);
    const terms = taxonomy.terms.filter((t) => t.facet === facet);
    lines.push(`\n## ${facet} — ${meta.label}`);
    if (meta.note) lines.push(meta.note);
    lines.push(
      meta.multi
        ? "Choose every term that applies."
        : "Choose exactly one term.",
    );
    lines.push("");
    for (const t of terms) {
      const parent = t.parents.length ? ` <${t.parents.join(",")}>` : "";
      const syn = t.synonyms.length ? `  (${t.synonyms.join(", ")})` : "";
      lines.push(`- ${t.id}${parent}${syn}`);
    }
  }
  return lines.join("\n");
}
