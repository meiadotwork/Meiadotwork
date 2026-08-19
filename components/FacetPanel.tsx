"use client";

import { useState } from "react";
import {
  type FacetId, type Term, byId, facetById, rootTerms, termsOfFacet,
} from "@/lib/taxonomy";
import type { Selection } from "@/lib/search";

/**
 * Subject has 329 terms — far too many to show as chips — so only the top of
 * the hierarchy is offered. Anything more specific comes from the text box,
 * which still resolves through synonyms and rolls up to these parents.
 */
function chipTerms(facet: FacetId): Term[] {
  return facet === "subject" ? rootTerms(facet) : termsOfFacet(facet);
}

function FacetGroup({
  facet,
  selection,
  counts,
  onToggle,
  defaultOpen,
}: {
  facet: FacetId;
  selection: Selection;
  counts: Map<string, number>;
  onToggle: (facet: FacetId, id: string) => void;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const terms = chipTerms(facet);
  const chosen = selection[facet] ?? [];
  const meta = facetById.get(facet)!;

  return (
    <section className="border-b border-ink-800 py-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left cursor-pointer"
        aria-expanded={open}
      >
        <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-ink-400">
          {meta.label}
          {chosen.length > 0 && (
            <span className="ml-2 text-accent">{chosen.length}</span>
          )}
        </span>
        <span className="text-ink-600">{open ? "–" : "+"}</span>
      </button>

      {open && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {terms.map((t) => {
            const active = chosen.includes(t.id);
            const n = counts.get(t.id) ?? 0;
            const dead = n === 0 && !active;
            return (
              <button
                key={t.id}
                type="button"
                disabled={dead}
                onClick={() => onToggle(facet, t.id)}
                title={t.synonyms.length ? `also: ${t.synonyms.join(", ")}` : t.label}
                className={[
                  "rounded-full px-2.5 py-1 text-xs transition cursor-pointer",
                  active
                    ? "bg-accent text-ink-950 font-medium"
                    : dead
                      ? "cursor-not-allowed text-ink-700 ring-1 ring-ink-850"
                      : "text-ink-300 ring-1 ring-ink-700 hover:ring-ink-400 hover:text-ink-50",
                ].join(" ")}
              >
                {t.label}
                {!active && n > 0 && (
                  <span className="ml-1.5 text-[10px] text-ink-600">{n}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default function FacetPanel({
  order,
  selection,
  countsFor,
  onToggle,
  onClear,
}: {
  order: FacetId[];
  selection: Selection;
  countsFor: (f: FacetId) => Map<string, number>;
  onToggle: (facet: FacetId, id: string) => void;
  onClear: () => void;
}) {
  const total = order.reduce((n, f) => n + (selection[f]?.length ?? 0), 0);

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h2
          className="text-xl text-ink-50"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Refine
        </h2>
        {total > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="text-xs text-ink-400 underline underline-offset-4 hover:text-ink-50 cursor-pointer"
          >
            Clear {total}
          </button>
        )}
      </div>

      {total > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {order.flatMap((f) =>
            (selection[f] ?? []).map((id) => (
              <button
                key={`${f}:${id}`}
                type="button"
                onClick={() => onToggle(f, id)}
                className="rounded-full bg-accent/15 px-2.5 py-1 text-xs text-accent ring-1 ring-accent/30 hover:bg-accent/25 cursor-pointer"
              >
                {byId.get(id)?.label ?? id} ×
              </button>
            )),
          )}
        </div>
      )}

      <div className="mt-2">
        {order.map((f, i) => (
          <FacetGroup
            key={f}
            facet={f}
            selection={selection}
            counts={countsFor(f)}
            onToggle={onToggle}
            defaultOpen={i < 2}
          />
        ))}
      </div>
    </div>
  );
}
