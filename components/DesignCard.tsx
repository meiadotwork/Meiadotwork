"use client";

import { byId } from "@/lib/taxonomy";
import type { Design } from "@/lib/search";

function labels(ids: string[] | undefined, max = 3): string[] {
  return (ids ?? []).slice(0, max).map((id) => byId.get(id)?.label ?? id);
}

const STATUS_STYLE: Record<string, string> = {
  available: "text-emerald-300/80",
  "one-off": "text-ink-400",
};

export default function DesignCard({
  design,
  onOpen,
}: {
  design: Design;
  onOpen: (d: Design) => void;
}) {
  const subjects = labels(design.tags.subject);
  const ratio = design.h / design.w;

  return (
    <button
      type="button"
      onClick={() => onOpen(design)}
      className="group block w-full text-left cursor-pointer"
      aria-label={`Open ${subjects.join(", ") || design.id}`}
    >
      <div className="relative overflow-hidden rounded-sm bg-ink-850 ring-1 ring-ink-800 transition group-hover:ring-ink-600">
        {design.thumb ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={design.thumb}
            alt={subjects.join(", ") || design.id}
            width={design.w}
            height={design.h}
            loading="lazy"
            decoding="async"
            className="w-full transition duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <div
            style={{ paddingBottom: `${ratio * 100}%` }}
            className="relative w-full bg-gradient-to-br from-ink-850 to-ink-900"
          >
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4">
              <span className="font-mono text-[10px] tracking-widest text-ink-600">
                {design.id}
              </span>
              <span
                className="text-center text-lg leading-tight text-ink-400"
                style={{ fontFamily: "var(--font-display)" }}
              >
                {subjects[0] ?? "Untagged"}
              </span>
            </div>
          </div>
        )}

        <div className="pointer-events-none absolute inset-x-0 bottom-0 translate-y-2 bg-gradient-to-t from-ink-950/95 to-transparent p-3 opacity-0 transition group-hover:translate-y-0 group-hover:opacity-100">
          <p className="truncate text-xs text-ink-200">{subjects.join(" · ")}</p>
          <p className="mt-0.5 truncate text-[11px] text-ink-400">
            {labels(design.tags.technique, 2).join(" · ")}
            {design.status ? (
              <span className={`ml-2 ${STATUS_STYLE[design.status] ?? ""}`}>
                {design.status === "one-off" ? "one-off" : design.status}
              </span>
            ) : null}
          </p>
        </div>
      </div>
    </button>
  );
}
