/**
 * Read the folder structure of a Dropbox archive without downloading it.
 *
 *   node scripts/peek-archive.mjs "https://www.dropbox.com/scl/fo/…?rlkey=…" [MB]
 *
 * Dropbox builds shared-folder zips on the fly, so they support neither range
 * requests nor a readable central directory up front. Instead this streams the
 * zip and harvests filenames from the local file header that precedes each
 * entry, discarding the image data as it goes. A few hundred MB of a multi-GB
 * archive is usually enough to see every folder.
 *
 * Names are written continuously, so stopping it early (or hitting a timeout)
 * still leaves usable output.
 */
import { createWriteStream } from "node:fs";

const LINK = process.argv[2];
const CAP = Number(process.argv[3] ?? 400) * 1024 * 1024;
const OUT = process.argv[4] ?? "data/archive-paths.txt";

if (!LINK) {
  console.error("Usage: node scripts/peek-archive.mjs <dropbox-link> [MB] [outfile]");
  process.exit(1);
}

const SIG = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // local file header: "PK\x03\x04"

const url = new URL(LINK);
url.searchParams.set("dl", "1");

const res = await fetch(url, { redirect: "follow" });
if (!res.ok) {
  console.error(`Dropbox returned ${res.status}. Check the link is still valid.`);
  process.exit(1);
}

const sink = createWriteStream(OUT);
const seen = new Set();
let carry = Buffer.alloc(0);
let read = 0;

for await (const chunk of res.body) {
  read += chunk.length;
  const buf = Buffer.concat([carry, Buffer.from(chunk)]);
  let i = 0;
  while (true) {
    const at = buf.indexOf(SIG, i);
    if (at === -1 || at + 30 > buf.length) break;
    const nameLen = buf.readUInt16LE(at + 26);
    if (nameLen > 0 && nameLen < 512 && at + 30 + nameLen <= buf.length) {
      const name = buf.subarray(at + 30, at + 30 + nameLen).toString("utf8");
      // Compressed bytes occasionally contain the signature by chance; keep
      // only entries that read as real paths.
      if (/^[\x20-\x7E -￿]+$/.test(name) && !name.includes("\\") && !seen.has(name)) {
        seen.add(name);
        sink.write(name + "\n");
      }
    }
    i = at + 4;
  }
  // Retain a tail so a header split across chunks is not missed.
  carry = buf.subarray(Math.max(0, buf.length - 600));
  if (read >= CAP) break;
}
try { await res.body.cancel(); } catch { /* already drained */ }
sink.end();

console.error(`scanned ${(read / 1048576).toFixed(0)} MB — ${seen.size} unique paths -> ${OUT}`);

const folders = new Map();
for (const p of seen) {
  const parts = p.split("/").filter(Boolean);
  if (parts.length < 2) continue;
  for (let d = 1; d < parts.length; d++) {
    const key = parts.slice(0, d).join("/");
    folders.set(key, (folders.get(key) ?? 0) + 1);
  }
}
console.error("\nfolders found:");
[...folders.entries()]
  .sort((a, b) => a[0].localeCompare(b[0]))
  .forEach(([f, n]) => console.error(`  ${"  ".repeat(f.split("/").length - 1)}${f.split("/").pop()}  (${n})`));
