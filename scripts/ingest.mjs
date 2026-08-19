/**
 * Step 2 of the pipeline: turn a pile of Dropbox images into web thumbnails
 * plus a manifest keyed by a stable ID.
 *
 *   node scripts/ingest.mjs --link "https://www.dropbox.com/scl/fo/...?rlkey=..."
 *   node scripts/ingest.mjs --dir  ~/Dropbox/Designs
 *   node scripts/ingest.mjs --zip  data/archive.zip
 *
 * Options:
 *   --size 600        longest edge of the generated thumbnail
 *   --watermark TEXT  stamp thumbnails (originals are never modified)
 *   --prefix MEIA     ID prefix
 *
 * Originals are only ever read. Nothing is renamed, moved or deleted.
 */
import { execFileSync } from "node:child_process";
import {
  existsSync, mkdirSync, readdirSync, statSync, writeFileSync, createWriteStream,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "..");
const DATA = path.join(ROOT, "data");
const THUMBS = path.join(ROOT, "public", "thumbs");
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".heic", ".avif"]);

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const SIZE = Number(arg("size", "600"));
const PREFIX = arg("prefix", "MEIA");
const WATERMARK = arg("watermark");

/** Dropbox serves a zip of a shared folder when dl=1. */
function directDownloadUrl(link) {
  const u = new URL(link);
  u.searchParams.set("dl", "1");
  return u.toString();
}

async function downloadZip(link) {
  mkdirSync(DATA, { recursive: true });
  const dest = path.join(DATA, "archive.zip");
  const url = directDownloadUrl(link);
  process.stdout.write(`downloading ${url}\n`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(
      `Dropbox returned ${res.status}. Check the link is a *shared* link with ` +
      `view access, and that the folder is not too large to zip.`,
    );
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  process.stdout.write(`saved ${dest}\n`);
  return dest;
}

function extractZip(zipPath) {
  const dest = path.join(DATA, "originals");
  mkdirSync(dest, { recursive: true });
  execFileSync("unzip", ["-o", "-q", zipPath, "-d", dest], { stdio: "inherit" });
  return dest;
}

function walkImages(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    for (const entry of readdirSync(cur, { withFileTypes: true })) {
      // Skip Dropbox/macOS cruft that would otherwise become "designs"
      if (entry.name.startsWith(".") || entry.name === "__MACOSX") continue;
      const p = path.join(cur, entry.name);
      if (entry.isDirectory()) stack.push(p);
      else if (IMAGE_EXT.has(path.extname(entry.name).toLowerCase())) out.push(p);
    }
  }
  // Stable order => stable IDs across re-runs
  return out.sort((a, b) => a.localeCompare(b));
}

function watermarkSvg(text, w, h) {
  const fs = Math.max(12, Math.round(w * 0.035));
  return Buffer.from(
    `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
       <text x="${w - 12}" y="${h - 12}" text-anchor="end"
             font-family="sans-serif" font-size="${fs}"
             fill="white" fill-opacity="0.45">${text}</text>
     </svg>`,
  );
}

async function main() {
  const link = arg("link");
  const dirArg = arg("dir");
  const zipArg = arg("zip");

  let sourceDir;
  if (dirArg) sourceDir = path.resolve(dirArg);
  else if (zipArg) sourceDir = extractZip(path.resolve(zipArg));
  else if (link) sourceDir = extractZip(await downloadZip(link));
  else {
    console.error("Need one of --link, --dir or --zip. See the header of this file.");
    process.exit(1);
  }

  if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
    console.error(`Not a directory: ${sourceDir}`);
    process.exit(1);
  }

  const files = walkImages(sourceDir);
  if (!files.length) {
    console.error(`No images found under ${sourceDir}`);
    process.exit(1);
  }
  console.log(`found ${files.length} images`);

  mkdirSync(THUMBS, { recursive: true });
  const rows = [];
  let done = 0;
  let failed = 0;

  for (const [i, file] of files.entries()) {
    const id = `${PREFIX}-${String(i + 1).padStart(4, "0")}`;
    try {
      const buf = await readFile(file);
      const img = sharp(buf, { failOn: "none" });
      const meta = await img.metadata();

      let pipe = img.rotate().resize({
        width: SIZE, height: SIZE, fit: "inside", withoutEnlargement: true,
      });
      if (WATERMARK) {
        const scale = Math.min(SIZE / (meta.width || SIZE), SIZE / (meta.height || SIZE), 1);
        const tw = Math.round((meta.width || SIZE) * scale);
        const th = Math.round((meta.height || SIZE) * scale);
        pipe = pipe.composite([{ input: watermarkSvg(WATERMARK, tw, th), top: 0, left: 0 }]);
      }
      const out = await pipe.webp({ quality: 80 }).toBuffer({ resolveWithObject: true });
      writeFileSync(path.join(THUMBS, `${id}.webp`), out.data);

      rows.push({
        id,
        file: path.relative(sourceDir, file),
        thumb: `/thumbs/${id}.webp`,
        w: out.info.width,
        h: out.info.height,
        origW: meta.width ?? null,
        origH: meta.height ?? null,
      });
      done++;
    } catch (err) {
      failed++;
      console.warn(`  ! skipped ${path.basename(file)}: ${err.message}`);
    }
    if ((i + 1) % 100 === 0) console.log(`  ${i + 1}/${files.length}`);
  }

  mkdirSync(DATA, { recursive: true });
  writeFileSync(path.join(DATA, "manifest.json"), JSON.stringify(rows, null, 2) + "\n");

  const csv = [
    "id,file,thumb,w,h",
    ...rows.map((r) => `${r.id},"${r.file.replace(/"/g, '""')}",${r.thumb},${r.w},${r.h}`),
  ].join("\n");
  writeFileSync(path.join(DATA, "manifest.csv"), csv + "\n");

  console.log(`\nthumbnails -> public/thumbs/  (${done} ok, ${failed} skipped)`);
  console.log(`manifest   -> data/manifest.json + data/manifest.csv`);
  console.log(`next: node scripts/tag.mjs`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
