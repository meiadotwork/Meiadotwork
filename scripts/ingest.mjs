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
 *   --logo PATH       stamp the logo into the corner (originals are never modified)
 *   --watermark TEXT  stamp text instead, if no logo is given
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
import { tagsFromPath } from "./vocab.mjs";

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
const LOGO = arg("logo");
/** Share of the thumbnail's width the logo badge occupies. */
const LOGO_SCALE = 0.18;
const MARGIN = 10;

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

/**
 * Most of the archive is line art scanned on white paper, so a plain white mark
 * is invisible. Dark text over a light outline stays readable on both a bright
 * scan and a dark photograph.
 */
function watermarkSvg(text, w, h) {
  const fs = Math.max(12, Math.round(w * 0.035));
  const x = w - 12;
  const y = h - 12;
  const esc = String(text).replace(/[<>&"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c],
  );
  const common = `x="${x}" y="${y}" text-anchor="end" font-family="sans-serif" font-size="${fs}"`;
  return Buffer.from(
    `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
       <text ${common} fill="none" stroke="#ffffff" stroke-opacity="0.6"
             stroke-width="${Math.max(2, Math.round(fs / 6))}"
             stroke-linejoin="round">${esc}</text>
       <text ${common} fill="#101010" fill-opacity="0.45">${esc}</text>
     </svg>`,
  );
}

const logoCache = new Map();

/**
 * The logo resized for a given thumbnail width. Thumbnails come in a handful of
 * sizes, so caching by target width avoids re-decoding the source for every
 * image in the archive.
 */
async function logoBadge(thumbWidth) {
  const target = Math.max(40, Math.round(thumbWidth * LOGO_SCALE));
  if (!logoCache.has(target)) {
    const buf = await sharp(LOGO)
      .resize({ width: target, height: target, fit: "inside" })
      .png()
      .toBuffer({ resolveWithObject: true });
    logoCache.set(target, { data: buf.data, w: buf.info.width, h: buf.info.height });
  }
  return logoCache.get(target);
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

  if (LOGO && !existsSync(LOGO)) {
    console.error(`Logo not found: ${LOGO}`);
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

      // Resize first, then measure. `rotate()` applies EXIF orientation, which
      // can swap width and height, so the source metadata cannot be used to
      // size the watermark overlay.
      const resized = await img
        .rotate()
        .resize({ width: SIZE, height: SIZE, fit: "inside", withoutEnlargement: true })
        .toBuffer({ resolveWithObject: true });

      const { width: tw, height: th } = resized.info;
      let overlay = null;
      if (LOGO) {
        const badge = await logoBadge(tw);
        overlay = {
          input: badge.data,
          top: Math.max(0, th - badge.h - MARGIN),
          left: Math.max(0, tw - badge.w - MARGIN),
        };
      } else if (WATERMARK) {
        overlay = { input: watermarkSvg(WATERMARK, tw, th), top: 0, left: 0 };
      }

      const out = await (overlay
        ? sharp(resized.data).composite([overlay])
        : sharp(resized.data)
      )
        .webp({ quality: 80 })
        .toBuffer({ resolveWithObject: true });
      writeFileSync(path.join(THUMBS, `${id}.webp`), out.data);

      const rel = path.relative(sourceDir, file);
      const fromFolder = tagsFromPath(rel);
      rows.push({
        id,
        file: rel,
        thumb: `/thumbs/${id}.webp`,
        w: out.info.width,
        h: out.info.height,
        origW: meta.width ?? null,
        origH: meta.height ?? null,
        // Technique and form are the artist's own distinctions and are recorded
        // by the folder, so they are read here rather than guessed from the image.
        technique: fromFolder.technique,
        form: fromFolder.form ? [fromFolder.form] : [],
        subject: fromFolder.subject,
        status: fromFolder.status,
        publish: fromFolder.publish,
        excludedBy: fromFolder.reason,
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
    "id,file,thumb,w,h,technique,form,status,publish",
    ...rows.map((r) =>
      [
        r.id, `"${r.file.replace(/"/g, '""')}"`, r.thumb, r.w, r.h,
        `"${r.technique.join(" ")}"`, `"${r.form.join(" ")}"`, r.status, r.publish,
      ].join(","),
    ),
  ].join("\n");
  writeFileSync(path.join(DATA, "manifest.csv"), csv + "\n");

  const held = rows.filter((r) => !r.publish);
  const byReason = new Map();
  for (const r of held) byReason.set(r.excludedBy, (byReason.get(r.excludedBy) ?? 0) + 1);
  const withTech = rows.filter((r) => r.technique.length).length;
  const withForm = rows.filter((r) => r.form.length).length;

  console.log(`\nthumbnails -> public/thumbs/  (${done} ok, ${failed} skipped)`);
  console.log(`manifest   -> data/manifest.json + data/manifest.csv`);
  console.log(`\nfrom folder names, no AI needed:`);
  console.log(`  technique tagged: ${withTech}/${rows.length}`);
  console.log(`  form tagged:      ${withForm}/${rows.length}`);
  if (held.length) {
    console.log(`\nheld back from the website (${held.length}):`);
    for (const [reason, n] of byReason) console.log(`  ${n} in "${reason}"`);
  }
  console.log(`\nnext: node scripts/tag.mjs`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
