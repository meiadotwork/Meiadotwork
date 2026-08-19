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
still available or already tattooed, price band, source flash sheet.

## The vocabulary (`taxonomy/taxonomy.json`)

A *controlled* vocabulary — a fixed list of approved terms. This is the single most
important file in the project. Free-form tagging fails at this scale because
`linework` / `line work` / `line-work` become three different tags and search
silently misses matches.

**422 terms across 6 categories, 698 synonyms, 1,120 searchable strings.**

| Category | Terms | What it captures |
|---|---|---|
| `subject` | 329 | What's depicted — swallow, dagger, peony, skull, moon |
| `style` | 28 | Technique — fine-line, dotwork, blackwork, traditional |
| `colour` | 6 | Black & grey, full colour, red accent … (exactly one) |
| `placement` | 21 | Forearm, sternum, spine, ankle |
| `format` | 16 | Micro, large, vertical, circular, filler, band |
| `mood` | 22 | Gothic, romantic, nautical, memento mori, whimsical |

Two mechanisms make search forgiving:

- **Synonyms** — `knife` finds designs tagged `dagger`; `sakura` finds
  `cherry-blossom`; `black and gray` finds `black-and-grey`.
- **Parents** — tag a design `swallow` and it is automatically findable under
  `bird`. Tag the most *specific* term; the rollup is free.

Term IDs and synonyms are validated as globally unique, so a query is never
ambiguous. Genuinely ambiguous English words are resolved deliberately: `bow` is
the weapon (ribbons use `bow ribbon`), `palm` is the tree (the placement is
`hand-placement`), `spine` is the anatomical subject (the placement is
`spine-placement`).

## Pipeline

**1 — Vocabulary.** ✅ Done. Review and adjust before anything gets tagged; changing
it afterwards means re-reviewing.

**2 — Get images out of Dropbox.** Copy (don't move) into a working folder. Generate
a ~600px web thumbnail per design. Full-resolution originals never go on the
website — that's what makes designs trivial to steal. Build `manifest.csv`:
one row per design, filename as the key.

**3 — Auto-tag pass.** Send each thumbnail to Claude with the vocabulary, get
structured JSON tags back. Run through the Batch API (50% cheaper, overnight).
Roughly **$15 one-time for all 3,000**.

**4 — Human review.** Correct the machine's guesses rather than authoring from
scratch — about 5–10 seconds per design instead of a minute, so ~6 hours total
instead of ~50. Review in priority order: your best 300 designs first, ship the
site, keep going in the background.

**5 — Website search.** 3,000 designs with tags is a JSON file of a few hundred KB.
That loads once and searches entirely in the browser — no backend, no database,
no server cost, and results appear as the client types. Filter chips per category
plus a free-text box.

## Fields the AI cannot infer

These get set by hand during review (step 4), and they matter commercially:

- `status` — available / repeatable / one-off (already tattooed, won't repeat)
- `price_band`
- `flash_sheet` — which sheet it came from

## Open questions

- Website platform (determines how step 5 is built)
- Watermarking policy for the public thumbnails
