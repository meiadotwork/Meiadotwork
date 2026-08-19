"use client";

import {
  useCallback, useDeferredValue, useEffect, useMemo, useRef, useState,
} from "react";
import { FACET_ORDER, type FacetId } from "@/lib/taxonomy";
import {
  buildIndex, facetCounts, runQuery, selectionCount,
  type Design, type Selection,
} from "@/lib/search";
import FacetPanel from "./FacetPanel";
import DesignCard from "./DesignCard";
import DesignDialog from "./DesignDialog";

const PAGE = 60;

const EXAMPLES = ["bird", "dagger", "fine line", "dotwork", "moth", "black and grey"];

export default function DesignSearch({
  designs,
  isSample,
}: {
  designs: Design[];
  isSample: boolean;
}) {
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<Selection>({});
  const [open, setOpen] = useState<Design | null>(null);
  const [visible, setVisible] = useState(PAGE);
  const [railOpen, setRailOpen] = useState(false);

  // Keeps typing responsive: the grid re-ranks at a lower priority.
  const deferredQuery = useDeferredValue(query);

  const index = useMemo(() => buildIndex(designs), [designs]);

  const results = useMemo(
    () => runQuery(designs, index, { query: deferredQuery, selection }),
    [designs, index, deferredQuery, selection],
  );

  /**
   * Standard faceted counts: each facet is counted against the results of
   * every *other* constraint, so its own chips do not zero each other out.
   */
  const counts = useMemo(() => {
    const map = new Map<FacetId, Map<string, number>>();
    for (const facet of FACET_ORDER) {
      const others: Selection = { ...selection };
      delete others[facet];
      const pool = runQuery(designs, index, {
        query: deferredQuery,
        selection: others,
      });
      map.set(facet, facetCounts(pool, facet));
    }
    return map;
  }, [designs, index, deferredQuery, selection]);

  const countsFor = useCallback(
    (f: FacetId) => counts.get(f) ?? new Map<string, number>(),
    [counts],
  );

  const toggle = useCallback((facet: FacetId, id: string) => {
    setSelection((prev) => {
      const cur = prev[facet] ?? [];
      const next = cur.includes(id)
        ? cur.filter((x) => x !== id)
        : [...cur, id];
      const out = { ...prev };
      if (next.length) out[facet] = next;
      else delete out[facet];
      return out;
    });
  }, []);

  const clear = useCallback(() => setSelection({}), []);

  // Any change to the query or filters restarts paging from the top.
  useEffect(() => {
    setVisible(PAGE);
  }, [deferredQuery, selection]);

  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisible((v) => Math.min(v + PAGE, results.length));
        }
      },
      { rootMargin: "600px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [results.length]);

  const shown = results.slice(0, visible);
  const nSel = selectionCount(selection);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-ink-800 bg-ink-950/95 backdrop-blur">
        <div className="mx-auto max-w-[1600px] px-4 py-4">
          <div className="flex items-center gap-4">
            <h1
              className="shrink-0 text-2xl tracking-wide text-ink-50"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Design Archive
            </h1>

            <div className="relative flex-1">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search — bird, knife, fine line, dotwork…"
                aria-label="Search designs"
                className="w-full rounded-sm border border-ink-700 bg-ink-900 px-4 py-2.5 text-sm text-ink-50 placeholder:text-ink-600 focus:border-accent focus:outline-none"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-500 hover:text-ink-50 cursor-pointer"
                  aria-label="Clear search"
                >
                  ✕
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => setRailOpen((v) => !v)}
              className="shrink-0 rounded-sm border border-ink-700 px-3 py-2.5 text-xs text-ink-300 hover:text-ink-50 lg:hidden cursor-pointer"
            >
              Filters{nSel > 0 ? ` (${nSel})` : ""}
            </button>
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
            <span>
              {results.length.toLocaleString()} of {designs.length.toLocaleString()} designs
            </span>
            <span className="text-ink-700">·</span>
            <span>try</span>
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => setQuery(ex)}
                className="text-ink-400 underline decoration-ink-700 underline-offset-4 hover:text-accent cursor-pointer"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>
      </header>

      {isSample && (
        <p className="border-b border-amber-500/20 bg-amber-500/10 px-4 py-2 text-center text-xs text-amber-200/90">
          Placeholder data — {designs.length} generated designs. Run the ingest and
          tagging pipeline to replace with the real archive.
        </p>
      )}

      <div className="mx-auto flex max-w-[1600px] gap-8 px-4 py-6">
        <aside
          className={[
            "rail shrink-0 lg:block lg:w-64",
            railOpen
              ? "fixed inset-0 z-40 overflow-y-auto bg-ink-950 p-4 lg:static lg:z-auto lg:bg-transparent lg:p-0"
              : "hidden",
          ].join(" ")}
        >
          {railOpen && (
            <button
              type="button"
              onClick={() => setRailOpen(false)}
              className="mb-4 text-sm text-ink-400 lg:hidden cursor-pointer"
            >
              ← Back to results
            </button>
          )}
          <div className="lg:sticky lg:top-28 lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto lg:pr-2">
            <FacetPanel
              order={FACET_ORDER}
              selection={selection}
              countsFor={countsFor}
              onToggle={toggle}
              onClear={clear}
            />
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          {results.length === 0 ? (
            <div className="py-24 text-center">
              <p
                className="text-xl text-ink-300"
                style={{ fontFamily: "var(--font-display)" }}
              >
                Nothing matches that yet
              </p>
              <p className="mt-2 text-sm text-ink-500">
                Try a broader word — {"“"}bird{"”"} rather than a
                specific species — or clear a filter.
              </p>
              {nSel > 0 && (
                <button
                  type="button"
                  onClick={clear}
                  className="mt-4 rounded-sm border border-ink-700 px-4 py-2 text-sm text-ink-200 hover:border-ink-400 cursor-pointer"
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="masonry">
                {shown.map((d) => (
                  <DesignCard key={d.id} design={d} onOpen={setOpen} />
                ))}
              </div>
              <div ref={sentinel} aria-hidden className="h-px" />
              {visible < results.length && (
                <p className="py-8 text-center text-xs text-ink-600">
                  Showing {shown.length} of {results.length}…
                </p>
              )}
            </>
          )}
        </main>
      </div>

      <DesignDialog design={open} onClose={() => setOpen(null)} />
    </div>
  );
}
