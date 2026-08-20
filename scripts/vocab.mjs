/** Shared vocabulary helpers for the tagging + indexing scripts. */
import { readFileSync } from "node:fs";

export const taxonomy = JSON.parse(
  readFileSync(new URL("../taxonomy/taxonomy.json", import.meta.url)),
);

export const FACETS = [
  "subject", "technique", "form", "colour", "placement", "format", "mood",
];

/** Facets the model is asked for. Technique and form come from the folder. */
export const MODEL_FACETS = ["subject", "colour", "placement", "format", "mood"];

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

/**
 * The vocabulary, rendered for the system prompt. Stable => cacheable.
 * Defaults to the facets the model is asked for, so no tokens are spent
 * describing technique and form, which come from the folder.
 */
export function vocabularyPrompt(facets = MODEL_FACETS) {
  const lines = [];
  for (const facet of facets) {
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

// ---------------------------------------------------------------------------
// Folder-derived tags
// ---------------------------------------------------------------------------

export const folderMap = JSON.parse(
  readFileSync(new URL("../taxonomy/folder-map.json", import.meta.url)),
);

/**
 * Derive tags from a design's path inside the archive. Technique and form are
 * the artist's own distinctions and are recorded by the folder, so they are
 * read here rather than guessed from the image.
 *
 * Returns { technique, form, subject, status, publish, reason }.
 */
export function tagsFromPath(relPath) {
  const parts = relPath.split("/");
  const segments = parts.slice(0, -1);
  const basename = normalise(parts.at(-1).replace(/\.[^.]+$/, ""));
  const technique = [];
  const subject = [];
  let form = null;
  let status = "available";
  let publish = true;
  let reason = null;

  for (const segment of segments) {
    const clean = normalise(segment).replace(/\s+\d+$/, ""); // strip "-456" count

    if (folderMap.ignoreSegments.some((s) => normalise(s) === clean)) continue;

    const excluded = folderMap.excludeSegments.find((s) => normalise(s) === clean);
    if (excluded) {
      publish = false;
      reason = segment;
    }

    const status_ = folderMap.statusSegments[clean];
    if (status_) status = status_;

    for (const token of clean.split(" ")) {
      const tech = folderMap.techniqueTokens[token];
      if (tech && !technique.includes(tech)) technique.push(tech);
      const f = folderMap.formTokens[token];
      if (f) form = f;
      const subj = folderMap.subjectTokens[token];
      if (subj && !subject.includes(subj)) subject.push(subj);
    }
  }

  // Some folders open with a title card for the flash sheet rather than a
  // design. They are not tattooable, so they stay out of the client-facing set.
  // Matched anywhere in the name: the folder name is sometimes appended
  // ("dotwork realform bookcover.jpg") and sometimes prefixed ("book coover
  // minimal solid realform.jpg"). Every entry is a phrase rather than the bare
  // word "cover", so a design named "cover up" is not swept up with them.
  const cover = folderMap.excludeFilenames.find((s) => {
    const n = normalise(s);
    return basename.includes(n) || basename.includes(n.replace(/\s+/g, ""));
  });
  if (cover) {
    publish = false;
    reason = cover;
  }

  return { technique, form, subject, status, publish, reason };
}
