import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePaceNotes, linkFor, chainText, gradeFor, effectiveRadius } from '../public/rally/pacenotes.js';
import { RouteTracker, CallScheduler, DriveSim } from '../public/rally/navcore.js';
import { buildStage, STAGE } from '../public/rally/sample-route.js';

const stage = buildStage();
const gen = generatePaceNotes(stage.points, { steps: stage.steps });

test('demo stage notes match the designed geometry', () => {
  const want = STAGE.map((s) => s[3]).filter((x) => x && !x.startsWith('(')).concat('finish');
  assert.deepEqual(gen.notes.map((n) => n.label), want);
});

test('links: into / and / distances', () => {
  const links = gen.notes.map((n) => linkFor(n.gapNext).say);
  assert.equal(links[1], 'into');   // left 4 -> right 3, 12 m apart
  assert.equal(links[3], 'and');    // left 3 tightens -> hairpin, 40 m
  assert.equal(links[0], '100');
  assert.equal(linkFor(60).say, 'then');
  assert.equal(linkFor(300, 'imperial').say, '300');
  assert.equal(linkFor(1000, 'imperial').say, 'half mile');
});

test('grading scale', () => {
  assert.equal(gradeFor(effectiveRadius(9, 175), 175), 'H');
  assert.equal(gradeFor(effectiveRadius(30, 90), 90), 3);
  assert.equal(gradeFor(effectiveRadius(60, 15), 15), null); // flat kink
  assert.equal(chainText(gen.notes, 1, 2), 'Left 4 into right 3, 200');
});

test('faster driving triggers calls earlier', () => {
  const avgLead = (cap) => {
    const sim = new DriveSim(gen.samples, gen.kappa, cap / 3.6), sch = new CallScheduler(gen.notes);
    const d = [];
    while (!sim.done) { const f = sim.tick(0.5); const c = sch.update(f.s, f.speed); if (c) d.push(c.distToNote); }
    return d.reduce((a, b) => a + b) / d.length;
  };
  assert.ok(avgLead(120) > avgLead(60) * 1.2);
});

test('tracker detects off-route offset', () => {
  const t = new RouteTracker(gen.samples);
  const p = gen.samples[100];
  assert.ok(t.locate(p.lat, p.lon).offset < 1);
  assert.ok(t.locate(p.lat + 0.001, p.lon).offset > 50); // ~110 m north
});

test('circuit: notes wrap the start line and calls keep coming lap after lap', () => {
  const loop = generatePaceNotes(stage.points, { steps: stage.steps, loop: true });
  assert.equal(loop.loop, true);
  assert.ok(!loop.notes.some((n) => n.kind === 'finish'));
  const last = loop.notes.at(-1);
  assert.ok(last.gapNext != null && last.gapNext >= 0); // links round to the first corner
  const sim = new DriveSim(loop.samples, loop.kappa, 90 / 3.6, { loop: true, laps: 3 });
  const tr = new RouteTracker(loop.samples, true);
  const sch = new CallScheduler(loop.notes, { loopLength: loop.total });
  let sU = null, lastS = 0, calls = 0;
  while (!sim.done) {
    const f = sim.tick(0.5), s = tr.locate(f.lat, f.lon).s;
    if (sU == null) sU = s; else { let d = s - lastS; if (d < -loop.total / 2) d += loop.total; sU += d; }
    lastS = s;
    if (sch.update(sU, f.speed)) calls++;
  }
  assert.ok(sU > 2.9 * loop.total);
  const perLap = new Set(loop.notes.map((n) => n.id)).size;
  assert.ok(calls >= 2.5 * Math.ceil(perLap / 4), `only ${calls} calls in 3 laps`);
});

// A Y junction where the route bears ~35° right onto a curving road (the Bronx
// Southern Blvd / Boston Rd case) must not be called "square".
import { offsetPoint, junctionShape } from '../public/rally/pacenotes.js';
function yJunction(turnDeg, R) {
  let p = [40.8380, -73.8870], brg = 0;
  const pts = [p];
  for (let i = 0; i < 8; i++) { p = offsetPoint(p, brg, 25); pts.push(p); }
  const node = p, before = brg;
  const L = (R * turnDeg * Math.PI) / 180;
  for (let d = 0; d < L; d += 8) { const seg = Math.min(8, L - d); p = offsetPoint(p, brg + (seg / R) * 90 / Math.PI, seg); brg += (seg / R) * 180 / Math.PI; pts.push(p); }
  for (let i = 0; i < 8; i++) { p = offsetPoint(p, brg, 25); pts.push(p); }
  const steps = [{ maneuver: { type: 'turn', modifier: 'slight right', location: [node[1], node[0]], bearing_before: before, bearing_after: 90 } }];
  return generatePaceNotes(pts, { steps }).notes.map((n) => n.label);
}

test('junction calls follow the real shape of the turn', () => {
  assert.match(yJunction(35, 60)[0], /^at junction, right [56]$/);
  assert.match(yJunction(90, 8)[0], /square right/);
  assert.match(yJunction(160, 8)[0], /hairpin right/);
  assert.equal(junctionShape(15), 'keep');
  assert.equal(junctionShape(135), 'acute');
});

test('gentle bends are called as flat / kink, and can be switched off', () => {
  const labels = gen.notes.map((n) => n.label);
  assert.ok(labels.includes('kink left'));
  const quiet = generatePaceNotes(stage.points, { steps: stage.steps, flats: false });
  assert.ok(!quiet.notes.some((n) => n.grade === 'F'));
});

test('vocabulary: crests from elevation, blind corners, reversed scale', () => {
  const withHills = generatePaceNotes(stage.points, { steps: stage.steps, elevation: stage.elevation });
  const L = withHills.notes.map((n) => n.label);
  assert.equal(L[0], 'right 6 over crest');
  assert.ok(L.includes('crest') && L.includes('dip'));
  assert.ok(L.includes('double caution, left 2')); // tight corner straight after a crest
  const rev = generatePaceNotes(stage.points, { steps: stage.steps, reverse: true });
  assert.equal(rev.notes[0].label, 'right 1');
  assert.equal(rev.notes.find((n) => n.mods.includes('tightens')).label, 'left 2, tightens 4');
});

test('vocabulary: chicane and recce notes', () => {
  // two short opposite flicks back to back -> chicane
  let p = [45.0, 7.0], brg = 0; const pts = [p];
  const go = (d) => { for (let x = 0; x < d; x += 10) { p = offsetPoint(p, brg, 10); pts.push(p); } };
  const arc = (R, a) => { const L = R * Math.abs(a) * Math.PI / 180; for (let d = 0; d < L; d += 4) { const st = Math.min(4, L - d), dt = (st / R) * 180 / Math.PI * Math.sign(a); p = offsetPoint(p, brg + dt / 2, st); brg += dt; pts.push(p); } };
  go(300); arc(40, 35); go(8); arc(40, -35); go(300);
  const c = generatePaceNotes(pts).notes;
  assert.match(c[0].label, /^chicane right left/);
  // a recce note on a corner joins that call; one on a straight stands alone
  const apex = gen.notes[2], mid = gen.samples[Math.round(2700 / 5)];
  const r = generatePaceNotes(stage.points, { steps: stage.steps, recce: [
    { id: 'a', lat: apex.lat, lon: apex.lon, words: ['rocks', 'outside'] },
    { id: 'b', lat: mid.lat, lon: mid.lon, words: ['bumps'] }] });
  assert.ok(r.notes.some((n) => n.label === 'right 3, rocks, outside'));
  assert.ok(r.notes.some((n) => n.kind === 'recce' && n.label === 'bumps'));
});

import { encodePolyline, decodePolyline, specToHash, hashToSpec } from '../public/rally/share.js';
test('share link round-trips the route, circuit flag and recce', () => {
  const via = [[40.83812, -73.88701], [40.84455, -73.88012], [40.85, -73.9]];
  assert.deepEqual(decodePolyline(encodePolyline(via)), via);
  const h = specToHash({ via }, { loop: true, recce: [{ lat: 40.8401, lon: -73.885, words: ['rocks', "don't cut"] }] });
  const back = hashToSpec('#' + h);
  assert.deepEqual(back.spec.via, via);
  assert.equal(back.loop, true);
  assert.deepEqual(back.recce[0].words, ['rocks', "don't cut"]);
  assert.equal(hashToSpec('#demo=1').spec.demo, true);
  assert.equal(hashToSpec('#nothing=1'), null);
});

test('speed cameras on the route are called, ones off it are ignored', () => {
  const on = gen.samples[Math.round(2700 / 5)], corner = gen.notes[1];
  const r = generatePaceNotes(stage.points, { steps: stage.steps, cameras: [
    { lat: on.lat, lon: on.lon, maxspeed: 50 },
    { lat: corner.lat, lon: corner.lon },
    { lat: on.lat + 0.01, lon: on.lon }] }); // ~1 km away
  assert.ok(r.notes.some((n) => n.kind === 'camera' && n.label === 'speed camera, limit 50'));
  assert.ok(r.notes.some((n) => n.label === 'left 4, speed camera'));
  assert.equal(r.notes.filter((n) => n.cams).length, 2);
});
