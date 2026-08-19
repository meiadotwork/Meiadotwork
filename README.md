# Meia — searchable tattoo design archive

Goal: clients can type `bird`, `knife`, `linework`, or `dotwork` into the site and
instantly narrow ~3,000 original designs down to the handful they want.

## The core decision: never rename the image files

The tempting approach is to rename every file with its keywords
(`bird-linework-small-forearm.jpg`). Don't. Filenames cap out near 255 characters,
they can't express *categories* (is "rose" a subject or a style?), renaming breaks
every Dropbox link already shared, and changing the vocabulary later means
re-renaming 3,000 files by hand.

Instead: **the filename is a permanent ID that is never touched again.** All tags
live in a separate table keyed to that ID. That table can hold unlimited keywords,
in structured categories, plus things a filename never could — whether a design is
still available or a one-off commission, price band, source flash sheet.

## The vocabulary (`taxonomy/taxonomy.json`)

Seven facets. Two of them — **technique** and **form** — are read from the folder
path rather than inferred from the image, because they are the artist's own
distinctions and a model would guess at them. The remaining five come from the
image via `scripts/tag.mjs`.

Subject runs three levels: **group → kind → specific**. Tag the most specific term
and every level above is implied, so tagging `swallow` makes a design findable
under `birds` and `animals` without tagging either.

| Facet | Terms | Source |
|---|---|---|
| `subject` | 355 (9 groups, 46 kinds, 300 specific) | model |
| `technique` | 10 — line work, dot work, dot by dot, minimal, solid, inverted, 3D, mandala, outline, stencil | **folder** |
| `form` | 2 — freeform (stylised), real form (true-to-life) | **folder** |
| `colour` | 5 | model |
| `placement` | 21 | model |
| `format` | 12 | model |
| `mood` | 20 | model |

The nine subject groups are Animals, Plants, People, Creatures, Objects,
Landscape, Symbols, Ornament and Lettering.

**Line weight is deliberately not tagged.** The folders do not record it, so it
would be either a model guess or a manual pass over 3,000 designs; `minimal`,
`line work` and `dot work` already cover what clients mean. It can be added later
without redoing anything.

### Why a controlled vocabulary

A fixed list of approved terms. Free-form tagging fails at this scale because
`linework` / `line work` / `line-work` become three different tags and search
silently misses matches.

Term ids and synonyms are validated unique *within each facet*, so a query is never
ambiguous. Overlaps across facets are fine and intended — subject `hand` and
placement `Hand` coexist because term resolution and the filter chips are both
facet-scoped.

Genuinely ambiguous English words are resolved deliberately: `bow` is the weapon
(ribbons use `bow ribbon`), `palm` is the tree (the placement is `hand-placement`),
`spine` is the anatomical subject (the placement is `spine-placement`).
## What the Dropbox archive already tells us

`scripts/peek-archive.mjs` reads a shared-folder zip's structure without downloading
it (Dropbox builds these on the fly, so there is no range support or readable
central directory — filenames are harvested from local headers mid-stream).

The top-level folders encode **two orthogonal axes at once**, and most carry their
file count in the name:

| Folder | Designs | Technique | Form |
|---|---|---|---|
| `minimal real-456` | 456 | minimal | real form |
| `minimal freeform-274` | 274 | minimal | freeform |
| `linework freeform-195` | 195 | line work | freeform |
| `linework real-170` | 170 | line work | real form |
| `dotwork freeform-164` | 164 | dot work | freeform |
| `minimal solid realform-107` | 107 | minimal + solid | real form |
| `dotwork realform-98` | 98 | dot work | real form |
| `minimal freeform solid-78` | 78 | minimal + solid | freeform |
| `inverted-54` | 54 | inverted | — |
| `dotbydot-37` | 37 | dot by dot | — |
| `3D-28` | 28 | 3D | — |
| `mandala` | ~200 | mandala | — |
| `others/custom` | ~300 | — | — |
| `others/stencil` | ~62 | stencil | — |
| `others/outline` | ~37 | outline | — |

**Technique and form therefore need no AI** — they are read from the path, which
makes them exact and free. Distinguishing "minimal freeform" from "minimal real" is
the artist's own distinction, not a universal one, so a model would guess at it. The
model's only job is identifying the *subject*.

Some subfolders are decisions rather than categories, and drive publication state:

| Folder | Effect |
|---|---|
| `dont like` | never published |
| `re do` | withheld until reworked |
| `others/stencil` | never published — working files |
| `others/outline` | never published — working files |
| `others/custom` | published, marked one-off commission |
| `on the book` | no effect — it records what was *printed*, nothing more |

`on the book` tracks which designs made it into the physical flash book. It is not
a record of what has been tattooed, so it carries no publication meaning and is
ignored. Whether a design has been tattooed is a separate question, deferred.

`.psd` and `.pdf` files are source files and are skipped.

## Pipeline

**1 — Vocabulary.** ✅ Done. Review and adjust before anything gets tagged; changing
it afterwards means re-reviewing.

**2 — Get images out of Dropbox.** Copy (don't move) into a working folder. Generate
a ~600px web thumbnail per design. Full-resolution originals never go on the
website — that's what makes designs trivial to steal. Build `manifest.csv`:
one row per design, filename as the key.

**3 — Auto-tag pass.** Send each thumbnail to Claude with the vocabulary, get
structured JSON tags back. The vocabulary sits in a cached system prompt, so it
is billed once rather than 3,000 times, and the run goes through the Batch API at
half price. Roughly **$20-25 one-time for all 3,000** on `claude-opus-5` at medium
effort; a smaller model costs less if you want to trade accuracy for spend.

Model output is mapped back onto canonical term ids, so a stray `Knife` becomes
`dagger` and `knives` still resolves — invented terms are reported rather than
silently accepted.

**4 — Human review.** Correct the machine's guesses rather than authoring from
scratch — about 5–10 seconds per design instead of a minute, so ~6 hours total
instead of ~50. Review in priority order: your best 300 designs first, ship the
site, keep going in the background.

**5 — Website search.** 3,000 designs with tags is a JSON file of a few hundred KB.
That loads once and searches entirely in the browser — no backend, no database,
no server cost, and results appear as the client types. Filter chips per category
plus a free-text box.

## Fields the AI cannot infer

`status` is derived from the folder (`custom` → one-off, otherwise available).
Price band and any per-design notes are set by hand during review.

## Running it

```bash
npm install

# 1 — (optional) inspect the archive, or pull a small real sample to trial on,
#     without downloading the whole 3.88 GB
node scripts/peek-archive.mjs "<dropbox-link>"
node scripts/fetch-sample.mjs "<dropbox-link>" 3     # ~3 images per folder

# 2 — export from Dropbox, build thumbnails + manifest
node scripts/ingest.mjs --link "https://www.dropbox.com/scl/fo/…?rlkey=…" \
                        --watermark "meia.work"
# or, keeping originals on your own machine:
node scripts/ingest.mjs --dir ~/Dropbox/Designs

# 3 — tag. Check size and cost first; nothing is sent.
node scripts/tag.mjs --limit 25 --dry-run
# then trial 25 and check quality before committing to the full run
node scripts/tag.mjs --limit 25 --sync
node scripts/tag.mjs                      # full run, Batch API
node scripts/tag.mjs --resume BATCH_ID    # collect a batch later

# 4 — review data/review.csv in any spreadsheet, then
node scripts/build-index.mjs              # or --only-reviewed

# 5 — site
npm run dev
npm run build
```

Tagging needs an Anthropic API key (`ANTHROPIC_API_KEY`, or `ant auth login`).
Everything else — ingest, thumbnails, folder-derived tags, the site — runs without one.

Measured on a real 25-design sample: **~$0.32** for the trial, **~$19** for all 3,000
through the Batch API on `claude-opus-5` at medium effort.

Streaming notes for the archive: Dropbox builds shared-folder zips on the fly, so
they support no range requests, and entries carry data descriptors rather than
sizes in the local header. Both scripts above account for that — `fetch-sample.mjs`
finds each entry's end by matching the trailer's recorded size, so the boundary is
verified rather than guessed.

### The review loop

`data/review.csv` is the human pass. Open it in Numbers, Excel or Sheets; the tag
columns are space-separated term ids. Fix what the model got wrong and put
anything in the `reviewed` column to mark a row done. Technique, form and status
are not in the sheet — they come from the folder and need no review. `build-index.mjs` reads the CSV back, validates every
term against the vocabulary, and reports typos rather than silently dropping them.

`--only-reviewed` publishes just the rows you have checked — so you can ship the
site with your best 300 designs and keep working through the rest.

## How search behaves

- **Parent rollup** — a design tagged `swallow` is found by "birds" and by "animals".
- **Synonyms** — "knife" finds `dagger`, "sakura" finds `cherry-blossom`,
  "black and gray" finds `black-and-grey`.
- **Typo tolerance** — "buterfly" still finds butterflies.
- **Chips narrow, text ranks** — filters combine with AND across categories, and
  each category's counts are computed against the *other* filters, so choosing one
  style does not zero out the rest.
- Everything runs in the browser from a single JSON file. No backend, no database,
  no per-search cost.

Covered by `tests/search.test.ts` (`npx tsx --test tests/search.test.ts`).

## Settled

- Subject is nine groups, three levels deep.
- Technique and form come from folder names, not the model.
- Line weight is not tagged for now.
- Stencils and outlines stay private.
- `on the book` means *printed*, and carries no publication meaning.

## Still open

- Watermarking text and whether to apply it at all
- Contact address for the enquiry button (currently `hello@meia.work`)
- Whether a design has been tattooed — deferred, to be handled later
