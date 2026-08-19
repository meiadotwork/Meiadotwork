"use client";

import { useEffect, useRef } from "react";
import { FACET_ORDER, byId, facetById } from "@/lib/taxonomy";
import type { Design } from "@/lib/search";

export default function DesignDialog({
  design,
  onClose,
}: {
  design: Design | null;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!design) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [design, onClose]);

  if (!design) return null;

  const subjects = (design.tags.subject ?? [])
    .map((id) => byId.get(id)?.label ?? id)
    .join(" · ");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={subjects || design.id}
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/90 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-sm bg-ink-900 ring-1 ring-ink-700 md:flex-row"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-1 items-center justify-center bg-ink-950 p-6">
          {design.thumb ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={design.thumb}
              alt={subjects || design.id}
              className="max-h-[60vh] w-auto object-contain"
            />
          ) : (
            <div className="flex h-64 w-full flex-col items-center justify-center gap-2 text-ink-600">
              <span className="font-mono text-xs tracking-widest">{design.id}</span>
              <span className="text-sm">image pending ingest</span>
            </div>
          )}
        </div>

        <div className="w-full shrink-0 overflow-y-auto border-t border-ink-800 p-6 md:w-80 md:border-l md:border-t-0">
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="absolute right-3 top-3 rounded px-2 py-1 text-ink-400 hover:text-ink-50 cursor-pointer"
            aria-label="Close"
          >
            ✕
          </button>

          <p
            className="pr-6 text-2xl leading-tight text-ink-50"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {subjects || "Untagged"}
          </p>
          <p className="mt-1 font-mono text-[11px] tracking-widest text-ink-600">
            {design.id}
          </p>

          {design.status && (
            <p className="mt-4 inline-block rounded-full bg-ink-800 px-3 py-1 text-xs text-ink-200">
              {design.status === "one-off" ? "One-off commission" : "Available"}
            </p>
          )}

          <dl className="mt-5 space-y-4">
            {FACET_ORDER.filter((f) => f !== "subject").map((f) => {
              const ids = design.tags[f] ?? [];
              if (!ids.length) return null;
              return (
                <div key={f}>
                  <dt className="text-[10px] uppercase tracking-[0.18em] text-ink-600">
                    {facetById.get(f)!.label}
                  </dt>
                  <dd className="mt-1 flex flex-wrap gap-1.5">
                    {ids.map((id) => (
                      <span
                        key={id}
                        className="rounded-full px-2 py-0.5 text-xs text-ink-300 ring-1 ring-ink-700"
                      >
                        {byId.get(id)?.label ?? id}
                      </span>
                    ))}
                  </dd>
                </div>
              );
            })}
          </dl>

          <a
            href={`mailto:hello@meia.work?subject=${encodeURIComponent(
              `Design enquiry — ${design.id}`,
            )}`}
            className="mt-6 block rounded-sm bg-accent px-4 py-2.5 text-center text-sm font-medium text-ink-950 transition hover:brightness-110"
          >
            Enquire about this design
          </a>
        </div>
      </div>
    </div>
  );
}
