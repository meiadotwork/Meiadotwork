// Rally pace note generator. Pure ES module, no DOM — runs in the browser and in Node.
//
// Pipeline: polyline -> resample every STEP m -> heading -> smoothed curvature ->
// corner runs -> grade (1-6 / hairpin) + modifiers -> merge junction calls from
// routing steps -> link words / distances between notes.

const DEG = Math.PI / 180;
const R_EARTH = 6371008.8;

export const DEFAULTS = {
  step: 5,            // resample spacing (m)
  sigma: 8,           // heading smoothing (m), irons out sparse OSM nodes
  kWindow: 2,         // curvature = heading diff over +-kWindow samples
  kMin: 1 / 400,      // anything gentler than R=400 m is straight
  minRunAngle: 4,     // drop curvature blips under this (deg)
  mergeGap: 20,       // same-direction runs closer than this are one corner (m)
  minCornerAngle: 12, // ignore corners with less total turn (deg)
  lineWidth: 3,       // usable road width for the racing line (m)
  flats: true,        // also call gentle bends as 'flat' / 'kink'
  flatLimit: 700,     // ...up to this effective radius (m)
};

// Effective-radius thresholds for the 1-6 scale (m). Speeds at ~0.8 g:
// 2 ≈ 50 km/h, 3 ≈ 70, 4 ≈ 90, 5 ≈ 110, 6 ≈ 140.
const GRADE_LIMITS = [[1, 22], [2, 35], [3, 55], [4, 85], [5, 130], [6, 220]];

// ---------- geometry ----------

export function segLen(a, b) {
  const mlat = ((a[0] + b[0]) / 2) * DEG;
  const dx = (b[1] - a[1]) * DEG * Math.cos(mlat) * R_EARTH;
  const dy = (b[0] - a[0]) * DEG * R_EARTH;
  return Math.hypot(dx, dy);
}

// Compass bearing a -> b, degrees clockwise from north.
export function bearing(a, b) {
  const mlat = ((a[0] + b[0]) / 2) * DEG;
  const dx = (b[1] - a[1]) * Math.cos(mlat);
  const dy = b[0] - a[0];
  return (Math.atan2(dx, dy) / DEG + 360) % 360;
}

// Point at distance d (m) along compass bearing brg (deg) from p.
export function offsetPoint(p, brg, d) {
  const dy = Math.cos(brg * DEG) * d, dx = Math.sin(brg * DEG) * d;
  return [p[0] + dy / R_EARTH / DEG, p[1] + dx / (R_EARTH * Math.cos(p[0] * DEG)) / DEG];
}

export function resample(points, step) {
  const pts = points.filter((p, i) => i === 0 || segLen(points[i - 1], p) > 0.01);
  const out = [{ lat: pts[0][0], lon: pts[0][1], s: 0 }];
  let segStart = 0, nextAt = step;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], L = segLen(a, b);
    while (nextAt <= segStart + L) {
      const t = (nextAt - segStart) / L;
      out.push({ lat: a[0] + (b[0] - a[0]) * t, lon: a[1] + (b[1] - a[1]) * t, s: nextAt });
      nextAt += step;
    }
    segStart += L;
  }
  const last = pts[pts.length - 1];
  if (segStart - out[out.length - 1].s > step * 0.3) out.push({ lat: last[0], lon: last[1], s: segStart });
  return { samples: out, total: segStart };
}

function gaussianSmooth(arr, sigmaSamples) {
  if (sigmaSamples <= 0) return arr.slice();
  const r = Math.ceil(sigmaSamples * 3), w = [];
  for (let k = -r; k <= r; k++) w.push(Math.exp(-(k * k) / (2 * sigmaSamples * sigmaSamples)));
  return arr.map((_, i) => {
    let sum = 0, ws = 0;
    for (let k = -r; k <= r; k++) {
      const j = i + k;
      if (j < 0 || j >= arr.length) continue;
      sum += arr[j] * w[k + r]; ws += w[k + r];
    }
    return sum / ws;
  });
}

// Signed curvature per sample (1/m). Positive = left.
export function curvature(samples, opt = DEFAULTS) {
  const n = samples.length;
  const kappa = new Array(n).fill(0);
  if (n < 4) return kappa;
  const H = [];
  for (let i = 0; i < n - 1; i++) {
    const a = samples[i], b = samples[i + 1];
    const mlat = ((a.lat + b.lat) / 2) * DEG;
    let h = Math.atan2(b.lat - a.lat, (b.lon - a.lon) * Math.cos(mlat)); // math angle, CCW
    if (i > 0) { // unwrap
      while (h - H[i - 1] > Math.PI) h -= 2 * Math.PI;
      while (h - H[i - 1] < -Math.PI) h += 2 * Math.PI;
    }
    H.push(h);
  }
  const Hs = gaussianSmooth(H, opt.sigma / opt.step);
  const k = opt.kWindow;
  for (let i = 0; i < Hs.length; i++) {
    const i0 = Math.max(0, i - k), i1 = Math.min(Hs.length - 1, i + k);
    if (i1 > i0) kappa[i] = (Hs[i1] - Hs[i0]) / ((i1 - i0) * opt.step);
  }
  return kappa;
}

// ---------- grading ----------

// Racing-line radius: a shallow corner can be straightened using the road width.
export function effectiveRadius(r, angleDeg, width = DEFAULTS.lineWidth) {
  const half = Math.min(angleDeg, 180) * DEG / 2;
  return r + width / Math.max(1e-6, 1 - Math.cos(half));
}

export function gradeFor(rEff, angleDeg) {
  if ((angleDeg >= 135 && rEff < 30) || (angleDeg >= 90 && rEff < 15)) return 'H';
  for (const [g, lim] of GRADE_LIMITS) if (rEff < lim) return g;
  return null; // flat
}
export const gradeNum = (g) => (g === 'H' ? 0 : g === 'F' ? 7 : g);

// ---------- corner detection ----------

function findCorners(samples, kappa, opt) {
  const { step } = opt;
  let runs = [];
  let cur = null;
  for (let i = 0; i < kappa.length; i++) {
    const sg = kappa[i] > opt.kMin ? 1 : kappa[i] < -opt.kMin ? -1 : 0;
    if (cur && sg === cur.sign) { cur.i1 = i; continue; }
    if (cur) runs.push(cur);
    cur = sg ? { sign: sg, i0: i, i1: i } : null;
  }
  if (cur) runs.push(cur);

  const angleOf = (r) => { let a = 0; for (let i = r.i0; i <= r.i1; i++) a += kappa[i] * step; return Math.abs(a) / DEG; };
  runs = runs.filter((r) => angleOf(r) >= opt.minRunAngle);

  const merged = [];
  for (const r of runs) {
    const prev = merged[merged.length - 1];
    if (prev && prev.sign === r.sign && (r.i0 - prev.i1) * step < opt.mergeGap) prev.i1 = r.i1;
    else merged.push({ ...r });
  }

  const corners = [];
  for (const r of merged) {
    const angle = angleOf(r);
    if (angle < (opt.flats ? 8 : opt.minCornerAngle)) continue;
    let peak = 0, apex = r.i0;
    for (let i = r.i0; i <= r.i1; i++) if (Math.abs(kappa[i]) > peak) { peak = Math.abs(kappa[i]); apex = i; }
    // trim the smoothing tails so distances are measured to where the bend really starts
    const cut = Math.max(opt.kMin, 0.25 * peak);
    let a = r.i0, b = r.i1;
    while (a < apex && Math.abs(kappa[a]) < cut) a++;
    while (b > apex && Math.abs(kappa[b]) < cut) b--;

    const rMin = 1 / peak;
    const rEff = effectiveRadius(rMin, angle, opt.lineWidth);
    let grade = gradeFor(rEff, angle);
    if (grade === null) {
      if (!opt.flats || rEff >= opt.flatLimit) continue;
      grade = 'F'; // gentle bend: "flat" if it lasts, "kink" if it's short
    }

    // entry vs exit severity -> tightens / opens
    const len = b - a + 1, third = Math.max(1, Math.round(len * 0.35));
    const avg = (from, to) => { let s = 0; for (let i = from; i <= to; i++) s += Math.abs(kappa[i]); return s / (to - from + 1); };
    const kIn = avg(a, a + third - 1), kOut = avg(b - third + 1, b);
    const gIn = gradeFor(effectiveRadius(1 / kIn, angle, opt.lineWidth), angle);
    const gOut = gradeFor(effectiveRadius(1 / kOut, angle, opt.lineWidth), angle);
    const sStart = samples[a].s, sEnd = samples[Math.min(b + 1, samples.length - 1)].s;

    const mods = [];
    if (grade !== 'H' && grade !== 'F' && len * step >= 30) {
      const nIn = gIn === null ? 7 : gradeNum(gIn), nOut = gOut === null ? 7 : gradeNum(gOut);
      if (kOut > kIn * 1.5 && nOut < nIn) mods.push('tightens');
      else if (kIn > kOut * 1.5 && nIn < nOut) mods.push('opens');
    }
    const lengthM = sEnd - sStart;
    if (grade !== 'H' && grade !== 'F' && (angle >= 135 || (lengthM >= 150 && angle >= 90))) mods.push('long');
    if (grade === 'H' || (grade === 1 && angle >= 90)) mods.push("don't cut");

    corners.push({
      kind: 'corner', dir: r.sign > 0 ? 'left' : 'right', grade, mods, kink: grade === 'F' && lengthM < 60,
      angle: Math.round(angle), rMin: Math.round(rMin), rEff: Math.round(rEff),
      exitGrade: gOut, sStart, sEnd, sApex: samples[apex].s,
      lat: samples[apex].lat, lon: samples[apex].lon,
    });
  }
  return corners;
}

// ---------- junctions (OSRM route steps) ----------

const ORD = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];

function nearestS(samples, lat, lon, fromIdx) {
  let best = Infinity, bi = fromIdx;
  for (let i = fromIdx; i < samples.length; i++) {
    const d = segLen([lat, lon], [samples[i].lat, samples[i].lon]);
    if (d < best) { best = d; bi = i; }
    if (best < 3 && d > 200) break; // found it and moved well past
  }
  return { idx: bi, dist: best };
}

// Turn angle actually driven through sample idx: heading over the 40 m before vs the 40 m after.
function turnAt(samples, idx) {
  const n = samples.length, k = 8;
  const i0 = Math.max(0, idx - k), i1 = Math.min(n - 1, idx + k);
  if (i1 - i0 < 4) return null;
  // road heading where the window starts vs where it ends = the whole turn inside it
  const a = samples[i0], a2 = samples[i0 + 1], c2 = samples[i1 - 1], c = samples[i1];
  const h1 = bearing([a.lat, a.lon], [a2.lat, a2.lon]), h2 = bearing([c2.lat, c2.lon], [c.lat, c.lon]);
  return ((h2 - h1 + 540) % 360) - 180; // + right
}

// Junction shape from the turn angle: keep / graded like a corner / square / acute / hairpin.
export function junctionShape(abs) {
  if (abs < 25) return 'keep';
  if (abs < 65) return 'graded';
  if (abs < 120) return 'square';
  if (abs < 150) return 'acute';
  return 'hairpin';
}

function junctionNotes(samples, steps, corners) {
  const out = [], suppress = [];
  let from = 0;
  steps.forEach((st, k) => {
    const m = st.maneuver;
    if (!m || !m.location) return;
    const { idx } = nearestS(samples, m.location[1], m.location[0], from);
    from = Math.min(idx + 1, samples.length - 1); // repeated laps: never match the same spot twice
    const s = samples[idx].s, lat = samples[idx].lat, lon = samples[idx].lon;
    const osrmTurn = ((m.bearing_after - m.bearing_before + 540) % 360) - 180; // + right
    // OSRM bearings only look at the very first metres of each road; the route
    // geometry tells us what the driver will really feel.
    const geo = turnAt(samples, idx);
    const turn = geo ?? osrmTurn;
    const dir = turn >= 0 ? 'right' : 'left';
    const abs = Math.abs(turn);
    // the geometry corner (if any) that this junction sits in
    const corner = corners.find((c) => c.dir === dir && c.sStart - 30 < s && c.sEnd + 30 > s);
    const base = { kind: 'junction', dir, angle: Math.round(abs), sStart: s - 8, sEnd: s + 8, sApex: s, lat, lon, mods: [] };
    const side = (m.modifier || '').includes('left') ? 'left' : (m.modifier || '').includes('right') ? 'right' : dir;

    switch (m.type) {
      case 'turn': case 'continue': case 'end of road': {
        if (m.type === 'continue' && abs < 45) return;
        if (m.type === 'turn' && abs < 10 && Math.abs(osrmTurn) < 20) return;
        const where = m.type === 'end of road' ? 'T junction' : 'at junction';
        let shape = junctionShape(abs), what;
        if (shape === 'graded') {
          const g = corner && corner.grade !== 'H' && corner.grade !== 'F' ? corner.grade : abs < 40 ? 5 : 4;
          what = `${dir} ${g}`; base.grade = g;
        } else what = shape === 'keep' ? `keep ${side}` : `${shape} ${shape === 'keep' ? side : dir}`;
        if (shape === 'keep') base.dir = side;
        if (corner) { base.sStart = Math.min(base.sStart, corner.sStart); base.sEnd = Math.max(base.sEnd, corner.sEnd); }
        out.push({ ...base, shape, text: `${where}, ${what}` });
        break;
      }
      case 'fork': out.push({ ...base, dir: side, shape: 'keep', text: `fork, keep ${side}` }); break;
      case 'merge': out.push({ ...base, dir: side, shape: 'keep', text: `merge ${side}` }); break;
      case 'on ramp': out.push({ ...base, dir: side, shape: 'keep', text: `slip road ${side}` }); break;
      case 'off ramp': out.push({ ...base, dir: side, shape: 'keep', text: `exit ${side}` }); break;
      case 'roundabout': case 'rotary': case 'roundabout turn': {
        const ex = m.exit ? `, ${ORD[m.exit - 1] || m.exit + 'th'} exit` : '';
        out.push({ ...base, dir: null, shape: 'roundabout', text: `roundabout${ex}` });
        const next = steps[k + 1];
        const exitS = next?.maneuver?.location ? nearestS(samples, next.maneuver.location[1], next.maneuver.location[0], idx).idx : idx;
        suppress.push([s - 25, samples[exitS].s + 25]);
        break;
      }
      case 'arrive': out.push({ ...base, kind: 'finish', dir: null, angle: null, shape: 'finish', text: 'finish', sStart: s, sEnd: s }); break;
      default: return; // depart, new name, notification, exit roundabout...
    }
    if (m.type !== 'arrive') suppress.push([s - 30, s + 30]);
  });
  return { notes: out, suppress };
}

// ---------- text ----------

export function noteText(n) {
  if (n.text) return n.text;
  const cap = n.mods.includes('caution') ? 'caution, ' : '';
  const long = n.mods.includes('long') ? 'long ' : '';
  const core = n.grade === 'H' ? `hairpin ${n.dir}` : n.grade === 'F' ? `${n.kink ? 'kink' : 'flat'} ${n.dir}` : `${n.dir} ${n.grade}`;
  const tail = ['tightens', 'opens'].filter((m) => n.mods.includes(m)).map((m) => ' ' + m).join('');
  const cut = n.mods.includes("don't cut") ? ", don't cut" : '';
  return cap + long + core + tail + cut;
}

const round50 = (v) => Math.max(50, Math.round(v / 50) * 50);
// Link from one note to the next given the straight between them.
export function linkFor(gapM, units = 'metric') {
  if (gapM == null) return { type: 'none', say: '' };
  if (gapM < 20) return { type: 'into', say: 'into' };
  if (gapM < 50) return { type: 'and', say: 'and' };
  if (units === 'imperial') {
    const yd = gapM * 1.09361;
    if (yd < 175) return { type: 'dist', say: String(round50(yd)) };
    if (yd < 800) return { type: 'dist', say: String(Math.round(yd / 100) * 100) };
    if (yd < 1300) return { type: 'dist', say: 'half mile' };
    if (yd < 2200) return { type: 'dist', say: '1 mile' };
    return { type: 'dist', say: 'long straight' };
  }
  if (gapM < 175) return { type: 'dist', say: String(round50(gapM)) };
  if (gapM < 950) return { type: 'dist', say: String(Math.round(gapM / 100) * 100) };
  if (gapM < 1500) return { type: 'dist', say: '1 k' };
  if (gapM < 2500) return { type: 'dist', say: '2 k' };
  return { type: 'dist', say: 'long straight' };
}

// Join notes[i..j] into one breath, co-driver style. Trailing distance included.
export function chainText(notes, i, j, units = 'metric') {
  let out = '';
  for (let k = i; k <= j; k++) {
    const n = notes[k];
    out += noteText(n);
    const l = linkFor(n.gapNext, units);
    if (l.type === 'none') break;
    if (k < j) out += l.type === 'dist' ? `, ${l.say}, ` : ` ${l.say} `;
    else out += l.type === 'dist' ? `, ${l.say}` : ` ${l.say}`;
  }
  return out.charAt(0).toUpperCase() + out.slice(1);
}

// ---------- main ----------

function rawNotes(samples, kappa, steps, opt) {
  let corners = findCorners(samples, kappa, opt);
  let junctions = [];
  if (steps && steps.length) {
    const j = junctionNotes(samples, steps, corners);
    junctions = j.notes;
    corners = corners.filter((c) => !j.suppress.some(([a, b]) => c.sEnd > a && c.sStart < b));
  }
  return [...corners, ...junctions].sort((a, b) => a.sStart - b.sStart);
}

function finalize(notes, loopLength) {
  const n = notes.length;
  notes.forEach((note, i) => {
    let prev = notes[i - 1], next = notes[i + 1];
    let gapNext = next ? next.sStart - note.sEnd : null;
    let straightBefore = prev ? note.sStart - prev.sEnd : note.sStart;
    if (loopLength) { // wrap around the start line
      if (!next) gapNext = notes[0].sStart + loopLength - note.sEnd;
      if (!prev) straightBefore = note.sStart + loopLength - notes[n - 1].sEnd;
    }
    note.id = i;
    note.gapNext = gapNext == null ? null : Math.max(0, gapNext);
    if (note.kind === 'corner') {
      const tight = gradeNum(note.grade) <= 2;
      const nastyTighten = note.mods.includes('tightens') && note.exitGrade !== null && gradeNum(note.exitGrade) <= 2;
      if ((tight && straightBefore >= 300) || nastyTighten) note.mods.unshift('caution');
    }
  });
  notes.forEach((note) => { note.label = noteText(note); });
  return notes;
}

/**
 * @param {Array<[lat,lon]>} points route polyline
 * @param {object} [o] { steps: OSRM steps (optional), loop: closed circuit, ...DEFAULTS overrides }
 * @returns {{ samples, kappa, total, notes, loop }}
 */
export function generatePaceNotes(points, o = {}) {
  const opt = { ...DEFAULTS, ...o };
  if (o.loop) return generateLoop(points, opt);
  const { samples, total } = resample(points, opt.step);
  const kappa = curvature(samples, opt);
  const notes = rawNotes(samples, kappa, o.steps, opt);
  if (!notes.some((n) => n.kind === 'finish')) {
    const L = samples[samples.length - 1];
    notes.push({ kind: 'finish', dir: null, text: 'finish', mods: [], sStart: total, sEnd: total, sApex: total, lat: L.lat, lon: L.lon });
  }
  return { samples, kappa, total, notes: finalize(notes), loop: false };
}

// Closed circuit: analyse three laps back to back and keep the notes from the
// middle one, so corners that straddle the start line are measured properly.
function generateLoop(points, opt) {
  const pts = points.slice();
  if (segLen(pts[0], pts[pts.length - 1]) > 1) pts.push(pts[0]);
  const { samples, total: L } = resample(pts, opt.step);
  const triple = [...pts, ...pts.slice(1), ...pts.slice(1)];
  const lapSteps = (opt.steps || []).filter((s) => !['arrive', 'depart'].includes(s.maneuver?.type));
  const tri = resample(triple, opt.step);
  const kTri = curvature(tri.samples, opt);
  const notes = rawNotes(tri.samples, kTri, [...lapSteps, ...lapSteps, ...lapSteps], opt)
    .filter((n) => n.kind !== 'finish' && n.sStart >= L && n.sStart < 2 * L)
    .map((n) => ({ ...n, sStart: n.sStart - L, sEnd: n.sEnd - L, sApex: n.sApex - L }));
  const kappa = samples.map((p) => kTri[Math.min(kTri.length - 1, Math.round((p.s + L) / opt.step))]);
  return { samples, kappa, total: L, notes: finalize(notes, L), loop: true };
}
