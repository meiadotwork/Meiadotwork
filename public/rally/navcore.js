// Live navigation core: map-matching, speed-aware call scheduling, drive simulator.
// Pure ES module (no DOM) so it can be tested in Node.

import { segLen, bearing, chainText, noteText } from './pacenotes.js';

const DEG = Math.PI / 180;

// ---------- map matching ----------

export class RouteTracker {
  constructor(samples) {
    this.samples = samples;
    this.idx = 0;
  }
  // Project a GPS fix onto the route. Searches near the last match first so a
  // road that doubles back on itself doesn't make the position jump.
  locate(lat, lon) {
    const S = this.samples;
    let r = this._search(lat, lon, Math.max(0, this.idx - 20), Math.min(S.length - 1, this.idx + 400));
    if (r.offset > 80) {
      const g = this._search(lat, lon, 0, S.length - 1);
      if (g.offset < r.offset - 20) r = g;
    }
    this.idx = r.idx;
    return r;
  }
  _search(lat, lon, from, to) {
    const S = this.samples, cos = Math.cos(lat * DEG), M = 111320;
    let best = { offset: Infinity, idx: from, s: S[from].s };
    for (let i = from; i < to; i++) {
      const a = S[i], b = S[i + 1];
      const ax = (a.lon - lon) * cos * M, ay = (a.lat - lat) * M;
      const bx = (b.lon - lon) * cos * M, by = (b.lat - lat) * M;
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1e-9;
      const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2));
      const px = ax + dx * t, py = ay + dy * t, d = Math.hypot(px, py);
      if (d < best.offset) best = { offset: d, idx: i, s: a.s + (b.s - a.s) * t };
    }
    const a = S[best.idx], b = S[Math.min(best.idx + 1, S.length - 1)];
    best.bearing = bearing([a.lat, a.lon], [b.lat, b.lon]);
    return best;
  }
}

// ---------- call scheduling ----------

export const CALL_AHEAD = { early: 7, normal: 5, late: 3.5 }; // seconds of warning after the call ends

// Rough TTS duration: ~3 words/s at rate 1.
export function speechSeconds(text, rate = 1.3) {
  const words = text.split(/[\s,]+/).filter(Boolean).length;
  return words / (3 * rate) + 0.3 * (text.split(',').length - 1) / rate;
}

export class CallScheduler {
  constructor(notes, opts = {}) {
    this.notes = notes;
    this.next = 0;            // first note not yet called
    this.opts = { callAhead: 'normal', rate: 1.3, units: 'metric', ...opts };
  }
  set(opts) { Object.assign(this.opts, opts); }
  // Skip everything already behind the car (after a reroute or GPS jump).
  seek(s) {
    this.next = 0;
    while (this.next < this.notes.length && this.notes[this.next].sApex < s) this.next++;
  }
  // Which notes would be read in one breath starting at i, at speed v.
  chainFrom(i, v) {
    const N = this.notes, window = Math.max(100, v * 3);
    let j = i;
    while (j < N.length - 1 && j - i < 3) {
      const g = N[j].gapNext;
      if (g == null || g > window) break;
      j++;
    }
    return j;
  }
  // Distance before the first note at which this chain must start being spoken.
  triggerDistance(text, v) {
    const lead = CALL_AHEAD[this.opts.callAhead] ?? 5;
    const t = lead + speechSeconds(text, this.opts.rate);
    return Math.min(900, Math.max(60, v * t + 15));
  }
  /** @returns null or { from, to, text, triggerDist, distToNote } */
  update(s, v) {
    const N = this.notes;
    // missed notes (passed the apex without a call) are dropped silently
    while (this.next < N.length && N[this.next].sApex < s - 5) this.next++;
    if (this.next >= N.length) return null;
    const i = this.next, j = this.chainFrom(i, v);
    const text = chainText(N, i, j, this.opts.units);
    const dist = N[i].sStart - s;
    const trig = this.triggerDistance(text, v);
    if (dist > trig) return null;
    this.next = j + 1;
    return { from: i, to: j, text, triggerDist: Math.round(trig), distToNote: Math.round(dist) };
  }
  // The note the driver is approaching right now (called or not), for the screen.
  upcoming(s) {
    const N = this.notes;
    let i = 0;
    while (i < N.length && N[i].sEnd < s) i++;
    return i < N.length ? { note: N[i], next: N[i + 1], dist: Math.max(0, N[i].sStart - s), label: noteText(N[i]) } : null;
  }
}

// ---------- simulator ----------

// Plausible speed along the route: limited by corner grip, acceleration and braking.
export function speedProfile(samples, kappa, vmax, { aLat = 5.5, aAcc = 2.5, aDec = 5 } = {}) {
  const n = samples.length;
  const v = samples.map((_, i) => Math.min(vmax, Math.sqrt(aLat / Math.max(Math.abs(kappa[i]), 1e-6))));
  v[0] = 0;
  for (let i = 1; i < n; i++) v[i] = Math.min(v[i], Math.sqrt(v[i - 1] ** 2 + 2 * aAcc * (samples[i].s - samples[i - 1].s)));
  v[n - 1] = 0;
  for (let i = n - 2; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] ** 2 + 2 * aDec * (samples[i + 1].s - samples[i].s)));
  return v;
}

export class DriveSim {
  constructor(samples, kappa, vmax) {
    this.samples = samples;
    this.v = speedProfile(samples, kappa, vmax);
    this.s = 0; this.i = 0; this.done = false;
  }
  tick(dt) {
    const S = this.samples;
    while (this.i < S.length - 2 && S[this.i + 1].s <= this.s) this.i++;
    const a = S[this.i], b = S[this.i + 1] || a;
    const t = b.s > a.s ? (this.s - a.s) / (b.s - a.s) : 0;
    const v0 = this.v[this.i], v1 = this.v[this.i + 1] ?? v0;
    const speed = Math.max(1.5, v0 + (v1 - v0) * t);
    this.s = Math.min(S[S.length - 1].s, this.s + speed * dt);
    if (this.s >= S[S.length - 1].s - 0.5) this.done = true;
    return {
      lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t,
      speed, heading: bearing([a.lat, a.lon], [b.lat, b.lon]), accuracy: 3, s: this.s,
    };
  }
}

export { segLen };
