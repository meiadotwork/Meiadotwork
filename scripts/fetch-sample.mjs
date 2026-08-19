/**
 * Pull a small, spread-out sample of real images out of the Dropbox archive
 * for a tagging trial, without downloading the whole thing.
 *
 *   node scripts/fetch-sample.mjs "<dropbox-link>" [perFolder] [capMB]
 *
 * Entries in this archive use data descriptors (flag 0x8), so the local header
 * reports no size. The real length sits in a trailer after the file data, so
 * each entry ends at the first PK\x07\x08 whose recorded size matches the bytes
 * seen since the header — which makes the boundary self-verifying rather than
 * guessed. Streaming stops as soon as enough folders are covered.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import path from "node:path";

const LINK = process.argv[2];
const PER_FOLDER = Number(process.argv[3] ?? 3);
const CAP = Number(process.argv[4] ?? 700) * 1024 * 1024;
const OUT = path.resolve(import.meta.dirname, "..", "data", "sample-originals");

if (!LINK) { console.error("Usage: node scripts/fetch-sample.mjs <link> [perFolder] [capMB]"); process.exit(1); }

const IMAGE = /\.(jpe?g|png|webp|tiff?)$/i;
const url = new URL(LINK);
url.searchParams.set("dl", "1");

const res = await fetch(url, { redirect: "follow" });
if (!res.ok) { console.error(`HTTP ${res.status}`); process.exit(1); }

mkdirSync(OUT, { recursive: true });

let buf = Buffer.alloc(0);
let read = 0;
let enough = false;
const perFolder = new Map();
const taken = [];

const LOCAL = 0x04034b50;
const DESC = Buffer.from([0x50, 0x4b, 0x07, 0x08]);

const folderOf = (name) => {
  const parts = name.split("/").filter(Boolean);
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "(root)";
};
const wantsMore = (name) =>
  IMAGE.test(name) && (perFolder.get(folderOf(name)) ?? 0) < PER_FOLDER;

/**
 * Find where an entry's data ends. Scans for the data-descriptor signature and
 * accepts it only when its recorded compressed size matches the distance from
 * the data start, so a PK\x07\x08 occurring inside JPEG bytes is rejected.
 */
function findDataEnd(b, from) {
  let at = from;
  while (true) {
    at = b.indexOf(DESC, at);
    if (at === -1 || at + 16 > b.length) return -1;
    if (b.readUInt32LE(at + 8) === at - from) return at;
    at += 4;
  }
}

let entry = null;

for await (const chunk of res.body) {
  read += chunk.length;
  buf = Buffer.concat([buf, Buffer.from(chunk)]);

  while (true) {
    if (!entry) {
      if (buf.length < 30) break;
      if (buf.readUInt32LE(0) !== LOCAL) {
        console.error("unexpected signature — stopping");
        enough = true;
        break;
      }
      const flags = buf.readUInt16LE(6);
      const method = buf.readUInt16LE(8);
      const csize = buf.readUInt32LE(18);
      const nlen = buf.readUInt16LE(26);
      const elen = buf.readUInt16LE(28);
      if (buf.length < 30 + nlen + elen) break;
      const name = buf.subarray(30, 30 + nlen).toString("utf8");
      buf = buf.subarray(30 + nlen + elen);
      if (!(flags & 8) && csize === 0) continue; // directory entry
      entry = { name, method, csize, streamed: Boolean(flags & 8), keep: wantsMore(name) };
    }

    let data;
    if (entry.streamed) {
      const end = findDataEnd(buf, 0);
      if (end === -1) break; // need more bytes
      data = buf.subarray(0, end);
      buf = buf.subarray(end + 16);
    } else {
      if (buf.length < entry.csize) break;
      data = buf.subarray(0, entry.csize);
      buf = buf.subarray(entry.csize);
    }

    if (entry.keep) {
      try {
        const bytes = entry.method === 0 ? Buffer.from(data) : inflateRawSync(data);
        const f = folderOf(entry.name);
        // Keep the directory structure: technique and form are derived from it.
        const dest = path.join(OUT, entry.name);
        mkdirSync(path.dirname(dest), { recursive: true });
        writeFileSync(dest, bytes);
        perFolder.set(f, (perFolder.get(f) ?? 0) + 1);
        taken.push({ path: entry.name, bytes: bytes.length });
        process.stderr.write(`  ${String(taken.length).padStart(3)}  ${entry.name}\n`);
      } catch (e) {
        process.stderr.write(`  !  ${entry.name}: ${e.message}\n`);
      }
    }
    entry = null;

    if (perFolder.size >= 9 && taken.length >= 25) { enough = true; break; }
  }
  if (enough || read >= CAP) break;
}
try { await res.body.cancel(); } catch { /* already done */ }

writeFileSync(path.join(OUT, "_index.json"), JSON.stringify(taken, null, 2) + "\n");
console.error(`\nstreamed ${(read / 1048576).toFixed(0)} MB — ${taken.length} images from ${perFolder.size} folders${enough ? "" : " (cap reached)"}`);
for (const [f, n] of [...perFolder].sort()) console.error(`  ${n}  ${f}`);
