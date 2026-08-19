/**
 * Build a single self-contained HTML page for sharing or testing: the gallery,
 * the search, and every thumbnail embedded as a data URI so it works with no
 * server and no network.
 *
 *   node scripts/make-preview.mjs [outfile]
 *
 * Search terms are expanded here rather than in the browser: each design's
 * searchable text already contains its tags, everything those tags imply, and
 * all their synonyms, so the page only has to match words.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { taxonomy, FACETS } from "./vocab.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = process.argv[2] ?? path.join(ROOT, "preview.html");

const byId = new Map(taxonomy.terms.map((t) => [t.id, t]));
const childrenOf = new Map();
for (const t of taxonomy.terms) {
  for (const p of t.parents) {
    if (!childrenOf.has(p)) childrenOf.set(p, []);
    childrenOf.get(p).push(t.id);
  }
}
function ancestors(id, seen = new Set()) {
  for (const p of byId.get(id)?.parents ?? []) {
    if (!seen.has(p)) { seen.add(p); ancestors(p, seen); }
  }
  return [...seen];
}
const expand = (ids) => {
  const out = new Set();
  for (const id of ids ?? []) { out.add(id); for (const a of ancestors(id)) out.add(a); }
  return [...out];
};

const { designs } = JSON.parse(readFileSync(path.join(ROOT, "public", "designs.json"), "utf8"));

const items = designs.map((d) => {
  const words = new Set();
  const facetIds = {};
  for (const f of FACETS) {
    const ids = expand(d.tags[f]);
    facetIds[f] = ids;
    for (const id of ids) {
      const t = byId.get(id);
      if (!t) continue;
      for (const phrase of [t.id, t.label, ...t.synonyms]) {
        for (const w of phrase.toLowerCase().split(/[^a-z0-9]+/)) if (w) words.add(w);
      }
    }
  }
  for (const w of (d.notes ?? "").toLowerCase().split(/[^a-z0-9]+/)) if (w) words.add(w);

  const file = path.join(ROOT, "public", d.thumb.replace(/^\//, ""));
  const b64 = readFileSync(file).toString("base64");
  return {
    id: d.id,
    w: d.w, h: d.h,
    src: `data:image/webp;base64,${b64}`,
    note: d.notes ?? "",
    tags: facetIds,
    label: (d.tags.subject ?? []).map((i) => byId.get(i)?.label ?? i).join(" · "),
    tech: (d.tags.technique ?? []).map((i) => byId.get(i)?.label ?? i).join(" · "),
    words: [...words].join(" "),
  };
});

// Chips: the nine subject groups, plus every term of the smaller facets.
const chips = {};
for (const f of FACETS) {
  const terms = f === "subject"
    ? taxonomy.terms.filter((t) => t.facet === f && t.parents.length === 0)
    : taxonomy.terms.filter((t) => t.facet === f);
  const used = new Set(items.flatMap((i) => i.tags[f] ?? []));
  chips[f] = terms.filter((t) => used.has(t.id)).map((t) => ({ id: t.id, label: t.label }));
}
const facetLabels = Object.fromEntries(taxonomy.facets.map((f) => [f.id, f.label]));

const html = `<title>Meia Design Search</title>
<style>
:root{--bg:#0a0a0b;--surface:#16161a;--line:#2a2a31;--dim:#7b7b8a;--text:#cfcfd8;--bright:#f4f2ee;--accent:#c8a668}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
header{position:sticky;top:0;z-index:10;background:rgba(10,10,11,.96);backdrop-filter:blur(8px);border-bottom:1px solid var(--line);padding:.9rem 1rem}
.bar{display:flex;gap:.8rem;align-items:center;max-width:1500px;margin:0 auto}
h1{font-family:ui-serif,Georgia,serif;font-weight:400;font-size:1.35rem;margin:0;color:var(--bright);white-space:nowrap}
input{flex:1;min-width:0;background:var(--surface);border:1px solid var(--line);color:var(--bright);border-radius:3px;padding:.6rem .8rem;font-size:.95rem;font-family:inherit}
input:focus{outline:none;border-color:var(--accent)}
.meta{max-width:1500px;margin:.6rem auto 0;font-size:.78rem;color:var(--dim);display:flex;gap:.5rem;flex-wrap:wrap;align-items:center}
.meta button{background:none;border:none;color:var(--dim);text-decoration:underline;text-underline-offset:3px;cursor:pointer;font-size:.78rem;font-family:inherit;padding:0}
.meta button:hover{color:var(--accent)}
.wrap{display:flex;gap:1.6rem;max-width:1500px;margin:0 auto;padding:1.2rem 1rem 4rem;align-items:flex-start}
aside{width:15rem;flex:none;position:sticky;top:6.5rem;max-height:calc(100vh - 8rem);overflow-y:auto}
@media(max-width:560px){h1{font-size:1.05rem}.bar{gap:.5rem}}
#toggle{display:none;background:var(--surface);border:1px solid var(--line);color:var(--text);border-radius:3px;padding:.6rem .7rem;font-size:.8rem;font-family:inherit;cursor:pointer;white-space:nowrap}
@media(max-width:860px){
  .wrap{flex-direction:column}
  aside{width:100%;position:static;max-height:none;display:none;order:-1}
  aside.open{display:block}
  #toggle{display:block}
}
.facet{border-bottom:1px solid var(--line);padding:.8rem 0}
.facet h2{font-size:.66rem;letter-spacing:.16em;text-transform:uppercase;color:var(--dim);margin:0 0 .55rem;font-weight:500;font-family:inherit}
.chips{display:flex;flex-wrap:wrap;gap:.3rem}
.chip{background:none;border:1px solid var(--line);color:var(--text);border-radius:99px;padding:.2rem .55rem;font-size:.74rem;cursor:pointer;font-family:inherit}
.chip:hover{border-color:var(--dim);color:var(--bright)}
.chip.on{background:var(--accent);color:#0a0a0b;border-color:var(--accent);font-weight:500}
.chip .n{color:var(--dim);margin-left:.3rem;font-size:.66rem}
.chip.on .n{color:rgba(10,10,11,.6)}
.chip.off{opacity:.32;cursor:default}
main{flex:1;min-width:0}
.grid{columns:1;column-gap:.85rem}
@media(min-width:460px){.grid{columns:2}}
@media(min-width:900px){.grid{columns:3}}
@media(min-width:1250px){.grid{columns:4}}
.card{break-inside:avoid;margin-bottom:.85rem;position:relative;border-radius:3px;overflow:hidden;background:var(--surface);border:1px solid var(--line);cursor:zoom-in;display:block;width:100%;padding:0}
.card img{width:100%;height:auto;display:block}
.cap{position:absolute;inset:auto 0 0 0;background:linear-gradient(to top,rgba(10,10,11,.96),transparent);padding:.5rem .6rem;opacity:0;transition:opacity .18s}
.card:hover .cap{opacity:1}
.cap b{display:block;font-weight:500;font-size:.76rem;color:var(--bright);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cap span{font-size:.68rem;color:var(--dim)}
.empty{padding:4rem 1rem;text-align:center;color:var(--dim)}
dialog{border:none;background:var(--surface);color:var(--text);max-width:min(94vw,880px);border-radius:4px;padding:0}
dialog::backdrop{background:rgba(10,10,11,.92)}
.dlg{display:flex;flex-direction:column}
@media(min-width:700px){.dlg{flex-direction:row}}
.dlg img{max-height:74vh;width:auto;height:auto;max-width:100%;background:#000;object-fit:contain}
.info{padding:1.1rem 1.3rem;min-width:15rem}
.info h3{font-family:ui-serif,Georgia,serif;font-weight:400;font-size:1.3rem;margin:0 0 .2rem;color:var(--bright)}
.info p{font-size:.82rem;color:var(--dim);margin:.3rem 0 1rem}
.info dt{font-size:.62rem;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);margin-top:.7rem}
.info dd{margin:.25rem 0 0;display:flex;flex-wrap:wrap;gap:.25rem}
.info dd span{border:1px solid var(--line);border-radius:99px;padding:.1rem .5rem;font-size:.72rem}
.close{position:absolute;top:.5rem;right:.7rem;background:none;border:none;color:var(--dim);font-size:1.2rem;cursor:pointer}
</style>

<header>
  <div class="bar">
    <h1>Design Archive</h1>
    <input id="q" placeholder="Search — bird, knife, mandala, dotwork…" aria-label="Search designs">
    <button id="toggle" aria-expanded="false">Filters</button>
  </div>
  <div class="meta">
    <span id="count"></span><span>·</span><span>try</span>
    <button data-ex="rose">rose</button><button data-ex="skull">skull</button>
    <button data-ex="knife">knife</button><button data-ex="animals">animals</button>
    <button data-ex="mandala">mandala</button><button data-ex="linework">linework</button>
    <button data-ex="people">people</button><button data-ex="reeper">reeper (typo)</button>
    <button id="clear" style="color:var(--accent)">reset</button>
  </div>
</header>

<div class="wrap">
  <aside id="facets"></aside>
  <main><div class="grid" id="grid"></div><div class="empty" id="empty" hidden>Nothing matches that. Try a broader word, or reset.</div></main>
</div>

<dialog id="dlg"><button class="close" onclick="dlg.close()">✕</button><div class="dlg" id="dlgBody"></div></dialog>

<script>
const ITEMS = ${JSON.stringify(items)};
const CHIPS = ${JSON.stringify(chips)};
const FACETS = ${JSON.stringify(FACETS)};
const LABELS = ${JSON.stringify(facetLabels)};
const TERM = ${JSON.stringify(Object.fromEntries(taxonomy.terms.map((t) => [t.id, t.label])))};

let sel = {};
const norm = s => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** One edit of tolerance, but only for words long enough to survive it. */
function near(a, b) {
  if (a === b) return true;
  if (b.startsWith(a)) return true;
  if (a.length <= 4) return false;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (a.length < b.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function matches(item, words) {
  const bag = item.words.split(" ");
  return words.every(w => bag.some(t => near(w, t)));
}

function passes(item) {
  return FACETS.every(f => !(sel[f] || []).length || (sel[f] || []).some(id => (item.tags[f] || []).includes(id)));
}

function results() {
  const words = norm(document.getElementById("q").value);
  return ITEMS.filter(i => passes(i) && (!words.length || matches(i, words)));
}

function countsFor(facet) {
  const words = norm(document.getElementById("q").value);
  const pool = ITEMS.filter(i =>
    FACETS.every(f => f === facet || !(sel[f] || []).length || (sel[f] || []).some(id => (i.tags[f] || []).includes(id)))
    && (!words.length || matches(i, words)));
  const c = {};
  for (const i of pool) for (const id of i.tags[facet] || []) c[id] = (c[id] || 0) + 1;
  return c;
}

function render() {
  const r = results();
  document.getElementById("count").textContent = r.length + " of " + ITEMS.length + " designs";
  const nSel = FACETS.reduce((n, f) => n + (sel[f] || []).length, 0);
  document.getElementById("toggle").textContent = nSel ? "Filters (" + nSel + ")" : "Filters";
  const grid = document.getElementById("grid");
  grid.innerHTML = r.map((i, n) => \`<button class="card" data-i="\${ITEMS.indexOf(i)}">
      <img src="\${i.src}" width="\${i.w}" height="\${i.h}" loading="\${n < 8 ? "eager" : "lazy"}" alt="\${i.label}">
      <span class="cap"><b>\${i.label || "Untagged"}</b><span>\${i.tech}</span></span></button>\`).join("");
  document.getElementById("empty").hidden = r.length > 0;

  document.getElementById("facets").innerHTML = FACETS.map(f => {
    const c = countsFor(f);
    const list = CHIPS[f].map(t => {
      const on = (sel[f] || []).includes(t.id), n = c[t.id] || 0;
      return \`<button class="chip \${on ? "on" : n ? "" : "off"}" data-f="\${f}" data-t="\${t.id}" \${!n && !on ? "disabled" : ""}>\${t.label}\${n ? \`<span class="n">\${n}</span>\` : ""}</button>\`;
    }).join("");
    return \`<div class="facet"><h2>\${LABELS[f]}</h2><div class="chips">\${list}</div></div>\`;
  }).join("");
}

document.addEventListener("click", e => {
  const chip = e.target.closest(".chip");
  if (chip && !chip.disabled) {
    const f = chip.dataset.f, t = chip.dataset.t;
    sel[f] = sel[f] || [];
    sel[f] = sel[f].includes(t) ? sel[f].filter(x => x !== t) : [...sel[f], t];
    return render();
  }
  const ex = e.target.closest("[data-ex]");
  if (ex) { document.getElementById("q").value = ex.dataset.ex; return render(); }
  if (e.target.id === "toggle") {
    const a = document.querySelector("aside");
    const open = a.classList.toggle("open");
    e.target.setAttribute("aria-expanded", String(open));
    return;
  }
  if (e.target.id === "clear") { sel = {}; document.getElementById("q").value = ""; return render(); }
  const card = e.target.closest(".card");
  if (card) {
    const i = ITEMS[+card.dataset.i];
    document.getElementById("dlgBody").innerHTML = \`<img src="\${i.src}" alt="\${i.label}">
      <div class="info"><h3>\${i.label || "Untagged"}</h3><p>\${i.note}</p>\` +
      FACETS.filter(f => f !== "subject" && (i.tags[f] || []).length).map(f =>
        \`<dt>\${LABELS[f]}</dt><dd>\${i.tags[f].map(id => \`<span>\${TERM[id] || id}</span>\`).join("")}</dd>\`).join("") +
      \`</div>\`;
    document.getElementById("dlg").showModal();
  }
});
document.getElementById("q").addEventListener("input", render);
render();
</script>`;

writeFileSync(OUT, html);
console.log(`wrote ${OUT} — ${items.length} designs, ${(html.length / 1048576).toFixed(1)} MB`);
