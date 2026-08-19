import MiniSearch, { type SearchResult } from "minisearch";
import {
  type FacetId, FACET_ORDER, byId, withAncestors, normalise,
} from "./taxonomy";

export type DesignStatus = "available" | "repeatable" | "one-off";

export interface Design {
  id: string;
  file: string;
  thumb: string;
  w: number;
  h: number;
  tags: Partial<Record<FacetId, string[]>>;
  title?: string;
  notes?: string;
  status?: DesignStatus;
  priceBand?: string;
  flashSheet?: string;
}

export type Selection = Partial<Record<FacetId, string[]>>;

/**
 * Words dropped from both the index and the query so they cancel out. Without
 * this, an AND query like "rose and dagger" would require a literal "and".
 */
const STOPWORDS = new Set([
  "a", "an", "and", "the", "of", "or", "with", "in", "on", "at", "to", "for",
]);

/**
 * Everything a design should be findable by for one facet: each tag, every
 * term it implies, and all their synonyms. A design tagged `swallow` becomes
 * findable under "bird" and "barn swallow" without being tagged either.
 */
function facetText(ids: string[] | undefined): string {
  if (!ids?.length) return "";
  const parts: string[] = [];
  for (const id of withAncestors(ids)) {
    const term = byId.get(id);
    if (!term) continue;
    parts.push(term.label, ...term.synonyms);
  }
  return parts.join(" ");
}

interface IndexedDesign {
  id: string;
  subject: string;
  style: string;
  colour: string;
  placement: string;
  format: string;
  mood: string;
  title: string;
  notes: string;
}

function toIndexed(d: Design): IndexedDesign {
  return {
    id: d.id,
    subject: facetText(d.tags.subject),
    style: facetText(d.tags.style),
    colour: facetText(d.tags.colour),
    placement: facetText(d.tags.placement),
    format: facetText(d.tags.format),
    mood: facetText(d.tags.mood),
    title: d.title ?? "",
    notes: d.notes ?? "",
  };
}

export function buildIndex(designs: Design[]): MiniSearch<IndexedDesign> {
  const mini = new MiniSearch<IndexedDesign>({
    idField: "id",
    fields: [
      "subject", "style", "colour", "placement", "format", "mood",
      "title", "notes",
    ],
    processTerm: (term) => {
      const t = normalise(term);
      return !t || STOPWORDS.has(t) ? null : t;
    },
    searchOptions: {
      boost: { subject: 4, title: 3, style: 2 },
      prefix: true,
      fuzzy: 0.2,
      combineWith: "AND",
    },
  });
  mini.addAll(designs.map(toIndexed));
  return mini;
}

/** True when the design satisfies every facet that has a selection. */
export function matchesSelection(d: Design, sel: Selection): boolean {
  for (const facet of FACET_ORDER) {
    const wanted = sel[facet];
    if (!wanted?.length) continue;
    const have = new Set(withAncestors(d.tags[facet] ?? []));
    if (!wanted.some((w) => have.has(w))) return false;
  }
  return true;
}

export function selectionCount(sel: Selection): number {
  return FACET_ORDER.reduce((n, f) => n + (sel[f]?.length ?? 0), 0);
}

export interface QueryOptions {
  query: string;
  selection: Selection;
  status?: DesignStatus | "any";
}

/**
 * Chips filter, text ranks. With no text the order is stable (source order)
 * so the grid does not reshuffle as chips are toggled.
 */
export function runQuery(
  designs: Design[],
  index: MiniSearch<IndexedDesign>,
  { query, selection, status = "any" }: QueryOptions,
): Design[] {
  const byIdMap = new Map(designs.map((d) => [d.id, d]));
  const trimmed = query.trim();

  let pool: Design[];
  if (trimmed) {
    const hits: SearchResult[] = index.search(trimmed);
    pool = hits
      .map((h) => byIdMap.get(String(h.id)))
      .filter((d): d is Design => Boolean(d));
  } else {
    pool = designs;
  }

  return pool.filter(
    (d) =>
      matchesSelection(d, selection) &&
      (status === "any" || d.status === status),
  );
}

/**
 * How many results each additional chip would yield, given what is already
 * selected. Lets the UI grey out chips that would return nothing.
 */
export function facetCounts(
  results: Design[],
  facet: FacetId,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const d of results) {
    for (const id of withAncestors(d.tags[facet] ?? [])) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
}
