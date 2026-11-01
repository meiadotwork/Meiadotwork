import { generatePaceNotes, linkFor, offsetPoint, segLen, RECCE_WORDS } from './pacenotes.js';
import { RouteTracker, CallScheduler, DriveSim } from './navcore.js';
import { buildStage } from './sample-route.js';

const $ = (id) => document.getElementById(id);
const OSRM = 'https://router.project-osrm.org/route/v1/driving/';
const ELEVATION = 'https://api.open-meteo.com/v1/elevation';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=';

// ---------- settings ----------
const settings = { callAhead: 'normal', rate: 1.3, units: 'metric', voice: '', flats: 'on', scale: 'wrc' };
try { Object.assign(settings, JSON.parse(localStorage.getItem('codriver.settings') || '{}')); } catch {}
// recce notes: words the crew added, pinned to a spot on the road (kept on this phone)
let recce = [];
try { recce = JSON.parse(localStorage.getItem('codriver.recce') || '[]'); } catch {}
const saveRecce = () => { try { localStorage.setItem('codriver.recce', JSON.stringify(recce)); } catch {} };
const saveSettings = () => { try { localStorage.setItem('codriver.settings', JSON.stringify(settings)); } catch {} };

// ---------- state ----------
const S = {
  route: null, nav: false, mode: 'idle', tracker: null, sched: null,
  follow: true, headingUp: true, heading: 0, rot: 0, speed: 0,
  fix: null, prevFix: null, offCount: 0, lastReroute: 0, lastOnRouteS: 0,
  watch: null, simTimer: null, wake: null, draw: [], drawLayer: null,
  routeLayer: null, noteLayer: null, meMarker: null,
  loop: false, sU: 0, lastS: null, lap: 0, lapStart: null, laps: [],
};

// ---------- map (oversized square so it can rotate without blank corners) ----------
const map = L.map('map', { zoomControl: false, attributionControl: false, zoomSnap: 0.25 }).setView([46, 8], 5);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, subdomains: 'abc' }).addTo(map);
function sizeMap() {
  const w = innerWidth, h = innerHeight, d = Math.ceil(Math.hypot(w, h));
  Object.assign($('map').style, { width: d + 'px', height: d + 'px', left: (w - d) / 2 + 'px', top: (h - d) / 2 + 'px' });
  map.invalidateSize(false);
}
sizeMap();
addEventListener('resize', sizeMap);
map.on('zoomend', () => document.body.classList.toggle('zfar', map.getZoom() < 15));

function setRotation(deg) {
  const d = ((deg - S.rot + 540) % 360) - 180; // shortest way round
  S.rot += d;
  $('map').style.transform = `rotate(${S.rot}deg)`;
}

navigator.geolocation?.getCurrentPosition((p) => {
  if (!S.route) map.setView([p.coords.latitude, p.coords.longitude], 13);
  S.fix = { lat: p.coords.latitude, lon: p.coords.longitude };
}, () => {}, { enableHighAccuracy: true, timeout: 8000 });

// ---------- helpers ----------
function toast(msg, ms = 2600) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), ms);
}
const kmh = (ms) => (settings.units === 'imperial' ? ms * 2.23694 : ms * 3.6);
function fmtDist(m) {
  if (settings.units === 'imperial') {
    const yd = m * 1.09361;
    return yd < 1000 ? `${Math.round(yd / 10) * 10} yd` : `${(m / 1609.34).toFixed(1)} mi`;
  }
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
}
function openSheet(id) { document.querySelectorAll('.sheet').forEach((s) => (s.hidden = s.id !== id)); }
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => (b.closest('.sheet').hidden = true)));

// ---------- voice ----------
let voices = [];
function loadVoices() {
  voices = (speechSynthesis?.getVoices() || []).filter((v) => v.lang.startsWith('en'));
  const sel = $('setVoice');
  sel.innerHTML = voices.map((v) => `<option value="${v.name}">${v.name} (${v.lang})</option>`).join('');
  if (!settings.voice) {
    const pref = voices.find((v) => /Daniel|UK English Male|Arthur|Oliver|George/i.test(v.name)) || voices.find((v) => v.lang === 'en-GB') || voices[0];
    settings.voice = pref?.name || '';
  }
  sel.value = settings.voice;
}
if ('speechSynthesis' in window) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }

function spoken(text) {
  return text.replace(/\b1 k\b/g, 'one K').replace(/\b2 k\b/g, 'two K').replace(/\bT junction\b/g, 'tee junction');
}
function speak(text, urgent = false) {
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(spoken(text));
  const v = voices.find((x) => x.name === settings.voice);
  if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-GB';
  u.rate = settings.rate; u.pitch = 0.95; u.volume = 1;
  if (urgent) speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

// ---------- routing ----------
async function fetchJSON(url, ms = 12000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch(url, { signal: ctl.signal }); if (!r.ok) throw new Error(r.status); return await r.json(); }
  finally { clearTimeout(t); }
}
async function osrmRoute(coords, startBearing) {
  const pts = coords.map((c) => `${c[1].toFixed(6)},${c[0].toFixed(6)}`).join(';');
  let url = `${OSRM}${pts}?overview=full&geometries=geojson&steps=true`;
  if (startBearing != null) url += `&bearings=${Math.round(startBearing)},60` + ';'.repeat(coords.length - 1);
  const j = await fetchJSON(url);
  if (j.code !== 'Ok' || !j.routes?.length) throw new Error(j.message || 'no route');
  const r = j.routes[0];
  const legs = r.legs;
  const steps = legs.flatMap((l, li) => l.steps.filter((s) => s.maneuver.type !== 'arrive' || li === legs.length - 1));
  return { points: r.geometry.coordinates.map(([lo, la]) => [la, lo]), steps };
}

function setRoute(r, { fit = true } = {}) {
  const gen = generatePaceNotes(r.points, {
    steps: r.steps, loop: !!r.loop, flats: settings.flats !== 'off', reverse: settings.scale === 'rev',
    elevation: r.elevation, recce,
  });
  S.route = { ...r, ...gen };
  if (!r.elevation && !r.elevTried) { S.route.elevTried = true; addElevation(S.route); }
  S.tracker = new RouteTracker(gen.samples, gen.loop);
  S.sched = newScheduler();
  // remember where each waypoint sits along the route, for rerouting
  const t = new RouteTracker(gen.samples);
  S.route.waypoints = (r.waypoints || []).map((w) => w.ll || w).map((w) => ({ ll: w, s: t.locate(w[0], w[1]).s }));
  drawRoute(fit);
  $('btnGo').disabled = false;
  $('routeActions').hidden = false;
  const corners = gen.notes.filter((n) => n.kind === 'corner').length;
  $('routeInfo').textContent = `${gen.loop ? 'Circuit · ' + fmtDist(gen.total) + ' lap' : fmtDist(gen.total)} · ${gen.notes.length} notes (${corners} corners)`;
  $('btnCancel').hidden = false;
  $('btnStart2').hidden = false;
}
// Re-make the notes for the current route (settings, recce or elevation changed) and carry on.
function regen(msg) {
  if (!S.route) return;
  setRoute(S.route, { fit: false });
  if (S.nav) S.sched.seek(S.route.loop ? S.sU : (S.lastOnRouteS || 0));
  if (msg) toast(msg);
}

// Crests and dips: ask Open-Meteo for ground height along the route (~90 m terrain model).
async function addElevation(route) {
  try {
    const sm = route.samples, total = route.total;
    const every = Math.max(1, Math.round(Math.max(30, total / 1500) / 5));
    const pick = sm.filter((_, i) => i % every === 0 || i === sm.length - 1);
    const out = [];
    for (let i = 0; i < pick.length; i += 100) {
      const part = pick.slice(i, i + 100);
      const j = await fetchJSON(`${ELEVATION}?latitude=${part.map((p) => p.lat.toFixed(5)).join(',')}&longitude=${part.map((p) => p.lon.toFixed(5)).join(',')}`);
      j.elevation.forEach((z, k) => out.push({ s: part[k].s, z }));
    }
    if (S.route?.samples !== route.samples) return; // route changed meanwhile
    S.route.elevation = out;
    const before = S.route.notes.length;
    regen();
    const n = S.route.notes.filter((x) => x.kind === 'vertical' || x.mods.includes('over crest')).length;
    if (n) toast(`Elevation: ${n} crest${n > 1 ? 's' : ''} / dips added`);
  } catch { /* offline or rate-limited: notes just stay flat */ }
}

const newScheduler = () => new CallScheduler(S.route.notes, { ...settings, loopLength: S.route.loop ? S.route.total : 0 });

// Build (or rebuild) a route from its spec, as a one-way stage or a closed circuit.
//   spec: { via: [[lat,lon]...] }            -> OSRM through these points
//         { raw: true, points, steps, demo }  -> use the geometry as given
async function buildRoute(spec, loop = S.loop, opts) {
  let r;
  if (spec.raw) {
    r = { points: spec.points, steps: spec.steps || [], elevation: spec.elevation };
  } else {
    const coords = loop ? [...spec.via, spec.via[0]] : spec.via;
    r = await osrmRoute(coords);
  }
  const via = spec.raw ? [spec.points[0], spec.points.at(-1)] : spec.via;
  setRoute({
    ...r, spec, loop,
    dest: loop ? via[0] : via.at(-1),
    waypoints: loop ? [...via.slice(1), via[0]] : via.slice(1),
  }, opts);
}

function cancelRoute() {
  if (S.nav) stopNav();
  S.routeLayer?.remove(); S.noteLayer?.remove();
  S.route = null; S.sched = null; S.tracker = null;
  $('btnGo').disabled = true;
  $('routeActions').hidden = true;
  $('btnCancel').hidden = true;
  $('btnStart2').hidden = true;
  $('routeInfo').textContent = '';
  toast('Route cancelled');
}

function drawRoute(fit) {
  S.routeLayer?.remove(); S.noteLayer?.remove();
  S.routeLayer = L.polyline(S.route.points, { color: '#ffcc00', weight: 6, opacity: .85 }).addTo(map);
  S.noteLayer = L.layerGroup(S.route.notes.map((n) => {
    const cls = n.kind === 'junction' ? 'junc' : (n.grade === 'H' || n.grade <= 2) ? 'tight' : '';
    return L.marker([n.lat, n.lon], { icon: L.divIcon({ className: `note-dot ${cls}`, iconSize: [12, 12] }), interactive: false })
      .bindTooltip(n.label, { permanent: true, direction: 'right', offset: [8, 0], className: 'note-tip' });
  })).addTo(map);
  if (fit) map.fitBounds(S.routeLayer.getBounds(), { padding: [40, 40] });
}

async function currentPos() {
  if (S.fix) return [S.fix.lat, S.fix.lon];
  try {
    const p = await new Promise((ok, no) => navigator.geolocation.getCurrentPosition(ok, no, { enableHighAccuracy: true, timeout: 8000 }));
    return [p.coords.latitude, p.coords.longitude];
  } catch {
    toast('No GPS fix — routing from map centre');
    const c = map.getCenter(); return [c.lat, c.lng];
  }
}

async function routeTo(dest) {
  toast('Routing…', 8000);
  try {
    const start = await currentPos();
    await buildRoute({ via: [start, dest] });
    $('toast').hidden = true;
  } catch (e) { toast('Routing failed: ' + e.message); }
}

// ---------- search / pick / draw / demo ----------
$('searchForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = $('searchInput').value.trim(); if (!q) return;
  const ul = $('results'); ul.innerHTML = '<li>Searching…</li>';
  try {
    const c = map.getCenter();
    const res = await fetchJSON(`${NOMINATIM}${encodeURIComponent(q)}&lat=${c.lat}&lon=${c.lng}`);
    ul.innerHTML = res.length ? '' : '<li>No results</li>';
    res.forEach((r) => {
      const li = document.createElement('li'); li.textContent = r.display_name;
      li.onclick = () => { ul.innerHTML = ''; $('routeSheet').hidden = true; routeTo([+r.lat, +r.lon]); };
      ul.appendChild(li);
    });
  } catch (err) { ul.innerHTML = `<li>Search failed: ${err.message}</li>`; }
});

$('btnPick').onclick = () => { S.mode = 'pick'; $('routeSheet').hidden = true; toast('Tap the map to set destination'); };
map.on('contextmenu', (e) => { if (!S.nav) routeTo([e.latlng.lat, e.latlng.lng]); }); // long-press
map.on('click', (e) => {
  if (S.nav) return;
  const ll = [e.latlng.lat, e.latlng.lng];
  if (S.mode === 'pick') { S.mode = 'idle'; routeTo(ll); }
  else if (S.mode === 'draw') { S.draw.push(ll); renderDraw(); }
});

function renderDraw() {
  S.drawLayer?.remove();
  S.drawLayer = L.layerGroup([
    L.polyline(S.draw, { color: '#4aa3ff', weight: 4, dashArray: '6 8' }),
    ...S.draw.map((p) => L.circleMarker(p, { radius: 6, color: '#4aa3ff', fillOpacity: 1 })),
  ]).addTo(map);
}
function endDraw() { S.mode = 'idle'; $('drawBar').hidden = true; S.drawLayer?.remove(); }
$('btnDraw').onclick = () => { S.mode = 'draw'; S.draw = []; $('routeSheet').hidden = true; $('drawBar').hidden = false; renderDraw(); };
$('drawUndo').onclick = () => { S.draw.pop(); renderDraw(); };
$('drawCancel').onclick = endDraw;
function paintLoop() {
  $('loopToggle').checked = S.loop;
  $('drawLoop').classList.toggle('on', S.loop);
  $('drawLoop').textContent = S.loop ? '⟳ Circuit' : '→ One way';
}
$('drawLoop').onclick = () => { S.loop = !S.loop; paintLoop(); };
$('loopToggle').onchange = async (e) => {
  S.loop = e.target.checked; paintLoop();
  if (!S.route) return;
  const wasNav = S.nav; if (wasNav) stopNav();
  toast(S.loop ? 'Closing the circuit…' : 'Back to one-way…', 8000);
  try { await buildRoute(S.route.spec, S.loop); $('toast').hidden = true; }
  catch (err) { toast('Routing failed: ' + err.message); S.loop = !S.loop; paintLoop(); }
};
$('btnCancel').onclick = cancelRoute;
$('btnStart2').onclick = () => startNav();
paintLoop();
$('drawSnap').onclick = async () => {
  if (S.draw.length < 2) return toast('Add at least two points');
  toast('Snapping to roads…', 8000);
  try {
    await buildRoute({ via: S.draw.slice() }); endDraw(); $('toast').hidden = true;
  } catch (e) { toast('Snap failed: ' + e.message); }
};
$('drawRaw').onclick = () => {
  if (S.draw.length < 2) return toast('Add at least two points');
  buildRoute({ raw: true, points: S.draw.slice() }); endDraw();
};
$('btnDemo').onclick = () => {
  const { points, steps, elevation } = buildStage();
  buildRoute({ raw: true, points, steps, elevation, demo: true });
  $('simSpeed').value = '90';
  toast('Demo stage loaded — Simulate is on');
};

// ---------- notes list ----------
$('btnNotes').onclick = () => {
  const N = S.route.notes;
  $('notesList').innerHTML = N.map((n, i) => {
    const l = linkFor(n.gapNext, settings.units);
    return `<li data-i="${i}">${n.label}${l.say ? ` <span class="link">${l.say}</span>` : ''}
      <small>${fmtDist(n.sStart)} in${n.angle ? ` · ${n.angle}°` : ''}${n.rMin ? ` · r ${n.rMin} m` : ''}${n.recce ? ' · recce ✎' : ''} · tap to add recce</small></li>`;
  }).join('');
  openSheet('notesSheet');
};
$('notesList').addEventListener('click', (e) => {
  const li = e.target.closest('li'); if (!li) return;
  const n = S.route.notes[+li.dataset.i];
  openRecce({ lat: n.lat, lon: n.lon, note: n });
});

// ---------- recce picker ----------
let recceTarget = null, recceWords = [];
const chipsHtml = Object.entries(RECCE_WORDS).map(([cat, words]) =>
  `<h3>${cat}</h3><div class="chips">${words.map((w) => `<button data-w="${w}">${w}</button>`).join('')}</div>`).join('');
$('recceChips').innerHTML = chipsHtml;
function paintRecce() {
  $('recceChips').querySelectorAll('button').forEach((b) => b.classList.toggle('on', recceWords.includes(b.dataset.w)));
  $('reccePreview').textContent = recceWords.length ? recceWords.join(', ') : 'Tap words in the order you want them read';
  $('recceSave').disabled = !recceWords.length;
}
function openRecce(target) {
  recceTarget = target; recceWords = [];
  $('recceWhat').textContent = target.note ? `On: ${target.note.label}` : 'Here, at your current position';
  $('recceClear').hidden = !target.note?.recce;
  paintRecce(); openSheet('recceSheet');
}
$('recceChips').addEventListener('click', (e) => {
  const w = e.target.dataset?.w; if (!w) return;
  recceWords = recceWords.includes(w) ? recceWords.filter((x) => x !== w) : [...recceWords, w];
  paintRecce();
});
$('recceSave').onclick = () => {
  recce.push({ id: Date.now().toString(36), lat: recceTarget.lat, lon: recceTarget.lon, words: recceWords.slice() });
  saveRecce(); $('recceSheet').hidden = true;
  regen('Recce note added: ' + recceWords.join(', '));
};
$('recceClear').onclick = () => {
  const ids = recceTarget.note?.recce || [];
  recce = recce.filter((r) => !ids.includes(r.id)); saveRecce();
  $('recceSheet').hidden = true; regen('Recce note removed');
};

$('btnRoute').onclick = () => {
  if (S.nav && S.fix) return openRecce({ lat: S.fix.lat, lon: S.fix.lon }); // while driving: quick "+ note"
  openSheet('routeSheet');
};
$('btnSettings').onclick = () => openSheet('settingsSheet');

// ---------- settings UI ----------
function bindSeg(id, key) {
  const el = $(id);
  const paint = () => el.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === settings[key]));
  el.addEventListener('click', (e) => {
    const v = e.target.dataset?.v; if (!v) return;
    settings[key] = v; saveSettings(); paint(); applySettings();
  });
  paint();
}
bindSeg('setAhead', 'callAhead');
bindSeg('setUnits', 'units');
bindSeg('setFlats', 'flats');
// Gentle-bend calls change the notes themselves: regenerate, and carry on from where we are.
$('setFlats').addEventListener('click', () => regen(settings.flats === 'off' ? 'Gentle bends: not called' : 'Gentle bends: flat / kink called'));
bindSeg('setScale', 'scale');
$('setScale').addEventListener('click', () => regen(settings.scale === 'rev' ? 'Scale: 1 = fastest, 6 = slowest' : 'Scale: 1 = slowest, 6 = fastest'));
$('setRate').value = settings.rate; $('rateVal').textContent = settings.rate.toFixed(2) + '×';
$('setRate').oninput = (e) => { settings.rate = +e.target.value; $('rateVal').textContent = settings.rate.toFixed(2) + '×'; saveSettings(); applySettings(); };
$('setVoice').onchange = (e) => { settings.voice = e.target.value; saveSettings(); };
$('btnTestVoice').onclick = () => speak('Left 5, 100, into right 3 tightens. Hairpin left, don\'t cut.', true);
function applySettings() {
  S.sched?.set({ callAhead: settings.callAhead, rate: settings.rate, units: settings.units });
  $('speedUnit').textContent = settings.units === 'imperial' ? 'mph' : 'km/h';
  if (S.route) $('routeInfo').textContent = `${S.route.loop ? 'Circuit · ' + fmtDist(S.route.total) + ' lap' : fmtDist(S.route.total)} · ${S.route.notes.length} notes`;
}
applySettings();

// ---------- me marker ----------
const meIcon = L.divIcon({ className: 'me-marker', iconSize: [34, 34], html: '<svg viewBox="0 0 40 40"><path d="M20 3 L34 35 L20 27 L6 35 Z"/></svg>' });
function drawMe(lat, lon, heading) {
  if (!S.meMarker) S.meMarker = L.marker([lat, lon], { icon: meIcon, interactive: false, zIndexOffset: 1000 }).addTo(map);
  S.meMarker.setLatLng([lat, lon]);
  const svg = S.meMarker.getElement()?.querySelector('svg');
  if (svg) svg.style.transform = `rotate(${heading}deg)`;
}

// ---------- glyph ----------
function glyph(n) {
  const g = $('glyph');
  if (!n) return (g.innerHTML = '');
  if (n.kind === 'finish') return (g.innerHTML = '<path d="M28 90 V12 M28 14 H76 L66 30 L76 46 H28"/>');
  if (n.kind === 'vertical') return (g.innerHTML = n.text.includes('dip') ? '<path d="M8 34 Q50 96 92 34"/>' : '<path d="M8 74 Q50 6 92 74"/>');
  if (n.kind === 'recce' || n.kind === 'feature') return (g.innerHTML = '<text x="50" y="76" text-anchor="middle" font-size="72">!</text>');
  if (n.chicane) return (g.innerHTML = `<path d="M50 94 V74 L${n.dir === 'right' ? 72 : 28} 54 L${n.dir === 'right' ? 28 : 72} 32 L50 12"/>`);
  if (n.shape === 'roundabout') return (g.innerHTML = '<path d="M50 92 V68 M50 68 A16 16 0 1 1 66 52 L84 40 M84 40 l-12 0 M84 40 l-3 11"/>');
  const R = { H: 8, 1: 10, 2: 13, 3: 17, 4: 22, 5: 28, 6: 34, F: 44 };
  let r, th;
  if (n.kind === 'junction') {
    r = { hairpin: 8, acute: 6, square: 5, keep: 40 }[n.shape] ?? R[n.grade] ?? 28;
    th = n.shape === 'keep' ? 20 : Math.max(25, Math.min(n.angle, 180));
  }
  else { r = R[n.grade]; th = Math.max(n.grade === 'F' ? 15 : 25, Math.min(n.angle, 180)); }
  const right = n.dir === 'right', x0 = 50 + (right ? -12 : 12), y0 = 60;
  const cx = right ? x0 + r : x0 - r;
  const phi = (right ? 180 + th : -th) * Math.PI / 180;
  const ex = cx + r * Math.cos(phi), ey = y0 + r * Math.sin(phi);
  const h = (-90 + (right ? th : -th)) * Math.PI / 180;
  const tx = ex + 12 * Math.cos(h), ty = ey + 12 * Math.sin(h);
  const ah = (a) => `M${tx.toFixed(1)} ${ty.toFixed(1)} l${(14 * Math.cos(h + a)).toFixed(1)} ${(14 * Math.sin(h + a)).toFixed(1)}`;
  g.innerHTML = `<path d="M${x0} 94 V${y0} A${r} ${r} 0 ${th > 180 ? 1 : 0} ${right ? 1 : 0} ${ex.toFixed(1)} ${ey.toFixed(1)} L${tx.toFixed(1)} ${ty.toFixed(1)} ${ah(2.5)} ${ah(-2.5)}"/>`;
}

// ---------- navigation ----------
function onFix(f) {
  const now = f.t || Date.now();
  // speed: device value if present, otherwise from successive fixes
  let v = f.speed;
  if ((v == null || isNaN(v)) && S.prevFix) {
    const dt = (now - S.prevFix.t) / 1000;
    v = dt > 0 ? segLen([S.prevFix.lat, S.prevFix.lon], [f.lat, f.lon]) / dt : 0;
  }
  S.speed = S.speed * 0.4 + (v || 0) * 0.6;
  S.prevFix = { lat: f.lat, lon: f.lon, t: now };
  S.fix = f;

  const loc = S.tracker.locate(f.lat, f.lon);
  const offLimit = Math.max(35, (f.accuracy || 10) * 1.5);
  if (loc.offset > offLimit) S.offCount++; else { S.offCount = 0; S.lastOnRouteS = loc.s; }

  if (f.heading != null && !isNaN(f.heading) && S.speed > 3) S.heading = f.heading;
  else if (loc.offset < 30) S.heading = loc.bearing;

  if (S.offCount >= 3 && now - S.lastReroute > 15000 && !S.simTimer) {
    if (S.route.loop) { // circuits: no reroute, just say so and pick up again when back on track
      S.lastReroute = now; speak('Off route.', true); toast('Off circuit — rejoin to continue');
    } else reroute([f.lat, f.lon]);
  }

  // distance along the stage; on a circuit it keeps growing lap after lap
  let sNow = loc.s;
  if (S.route.loop) {
    const L = S.route.total;
    if (S.lastS == null) { S.sU = loc.s; if (loc.s < 50) S.lapStart = now; }
    else {
      let d = loc.s - S.lastS;
      if (d < -L / 2) d += L; else if (d > L / 2) d -= L;
      const before = Math.floor(S.sU / L);
      S.sU += d;
      if (Math.floor(S.sU / L) > before) lapDone(now);
    }
    sNow = S.sU;
  }
  S.lastS = loc.s;

  const call = S.offCount ? null : S.sched.update(sNow, S.speed);
  if (call) { speak(call.text); $('lastCall').textContent = '“' + call.text + '”'; }

  // screen
  $('speed').textContent = Math.round(kmh(S.speed));
  const up = S.sched.upcoming(sNow);
  if (S.route.loop) $('lapInfo').textContent = lapLabel(now);
  if (up) {
    $('noteBig').textContent = up.label;
    $('noteBig').classList.toggle('caution', !!up.note.mods?.some((m) => m.includes('caution')));
    $('noteDist').textContent = up.dist > 0 ? fmtDist(up.dist) : 'NOW';
    const l = linkFor(up.note.gapNext, settings.units);
    $('noteNext').textContent = up.next ? `${l.say ? l.say + ' · ' : ''}${up.next.label}` : '';
    glyph(up.note);
  }
  drawMe(f.lat, f.lon, S.heading);
  if (S.follow) followCam(f.lat, f.lon);
}

const fmtTime = (ms) => { const t = ms / 1000, m = Math.floor(t / 60); return `${m}:${(t - m * 60).toFixed(1).padStart(4, '0')}`; };
function sayTime(ms) {
  const t = Math.round(ms / 1000), m = Math.floor(t / 60), sec = t % 60;
  return (m ? `${m} minute${m > 1 ? 's' : ''} ` : '') + `${sec} second${sec === 1 ? '' : 's'}`;
}
function lapDone(now) {
  S.lap++;
  if (S.lapStart != null) {
    const ms = now - S.lapStart, prevBest = Math.min(...S.laps); S.laps.push(ms);
    speak(`Lap ${S.laps.length}, ${sayTime(ms)}${S.laps.length > 1 && ms < prevBest ? ', best lap' : ''}.`);
  } else speak('Lap one. Go.');
  S.lapStart = now;
}
function lapLabel(now) {
  const n = S.laps.length + (S.lapStart != null ? 1 : 0);
  const cur = S.lapStart != null ? fmtTime(now - S.lapStart) : 'out lap';
  const last = S.laps.length ? ` · last ${fmtTime(S.laps.at(-1))} · best ${fmtTime(Math.min(...S.laps))}` : '';
  return n ? `LAP ${n} · ${cur}${last}` : 'OUT LAP — cross the start line';
}

function followCam(lat, lon) {
  const kph = S.speed * 3.6;
  const z = kph < 35 ? 17 : kph < 75 ? 16.25 : 15.5;
  let c = [lat, lon];
  if (S.headingUp) { // put the car low on screen so you see the road ahead
    const mpp = 156543.03392 * Math.cos(lat * Math.PI / 180) / 2 ** z;
    c = offsetPoint(c, S.heading, innerHeight * 0.22 * mpp);
  }
  map.setView(c, z, { animate: true, duration: S.simTimer ? 0.5 : 0.9, easeLinearity: 1, noMoveStart: true });
  setRotation(S.headingUp ? -S.heading : 0);
}

async function reroute(from) {
  S.lastReroute = Date.now();
  speak('Off route. Recalculating.', true);
  toast('Off route — recalculating…', 5000);
  const ahead = S.route.waypoints.filter((w) => w.s > S.lastOnRouteS + 20).map((w) => w.ll);
  const targets = ahead.length ? ahead : [S.route.dest];
  try {
    const r = await osrmRoute([from, ...targets], S.speed > 3 ? S.heading : null);
    setRoute({ ...r, spec: { via: [from, ...targets] }, loop: false, dest: S.route.dest, waypoints: targets }, { fit: false });
    S.sched.seek(5); S.offCount = 0;
    speak('Route updated.');
  } catch (e) { toast('Reroute failed: ' + e.message); }
}

async function keepAwake() {
  try { S.wake = await navigator.wakeLock?.request('screen'); } catch {}
}
document.addEventListener('visibilitychange', () => { if (S.nav && document.visibilityState === 'visible') keepAwake(); });

function startNav() {
  if (!S.route) return;
  S.nav = true; S.follow = true;
  document.body.classList.add('nav');
  document.querySelectorAll('.sheet').forEach((s) => (s.hidden = true));
  $('notepanel').hidden = false;
  $('btnGo').textContent = 'Stop'; $('btnGo').classList.add('stop');
  $('btnRoute').textContent = '＋ Note';
  map.dragging[S.headingUp ? 'disable' : 'enable']();
  S.tracker = new RouteTracker(S.route.samples, S.route.loop);
  S.sched = newScheduler();
  S.offCount = 0; S.prevFix = null; S.speed = 0;
  S.lastS = null; S.sU = 0; S.lap = 0; S.lapStart = null; S.laps = [];
  $('lapInfo').hidden = !S.route.loop; $('lapInfo').textContent = '';
  keepAwake();
  speak('Stage ready.', true); // also unlocks speech on iOS (needs a tap)

  const sim = +$('simSpeed').value;
  if (sim > 0) {
    const ds = new DriveSim(S.route.samples, S.route.kappa, sim / 3.6, { loop: S.route.loop });
    S.simTimer = setInterval(() => {
      const f = ds.tick(0.5); onFix({ ...f, t: Date.now() });
      if (ds.done) { clearInterval(S.simTimer); S.simTimer = null; toast('Stage complete'); }
    }, 500);
  } else {
    if (!navigator.geolocation) return toast('No GPS on this device');
    S.watch = navigator.geolocation.watchPosition(
      (p) => onFix({ lat: p.coords.latitude, lon: p.coords.longitude, speed: p.coords.speed, heading: p.coords.heading, accuracy: p.coords.accuracy, t: p.timestamp }),
      (e) => toast('GPS: ' + e.message),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
  }
}

function stopNav() {
  S.nav = false;
  if (S.watch != null) navigator.geolocation.clearWatch(S.watch);
  clearInterval(S.simTimer); S.watch = null; S.simTimer = null;
  S.wake?.release?.(); S.wake = null;
  speechSynthesis?.cancel();
  document.body.classList.remove('nav');
  $('notepanel').hidden = true;
  $('btnGo').textContent = 'Start'; $('btnGo').classList.remove('stop');
  $('btnRoute').textContent = 'Route';
  setRotation(0); map.dragging.enable();
}

$('btnGo').onclick = () => (S.nav ? stopNav() : startNav());
map.on('dragstart', () => { if (S.nav) S.follow = false; });
const paintCompass = () => { $('btnCompass').textContent = S.headingUp ? '▲' : 'N'; $('btnCompass').classList.toggle('on', S.follow && S.nav); };
$('btnCompass').onclick = () => {
  if (S.nav && !S.follow) S.follow = true;
  else S.headingUp = !S.headingUp;
  if (S.nav) map.dragging[S.headingUp ? 'disable' : 'enable']();
  if (!S.headingUp) setRotation(0);
  paintCompass();
  if (S.fix && S.nav) followCam(S.fix.lat, S.fix.lon);
};
paintCompass();
