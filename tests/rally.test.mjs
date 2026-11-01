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
