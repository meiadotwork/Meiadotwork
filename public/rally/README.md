# Co-Driver Nav

A navigation app for the phone browser that gives every instruction as a rally co-driver pace note. Nothing to install: open `/rally/index.html` over **HTTPS**, because phones only allow GPS and Wake Lock on secure pages.

## Files

| File | What it does |
|---|---|
| `pacenotes.js` | Pace note generator (pure JS, also runs in Node) |
| `navcore.js` | GPS-to-route matching, speed-aware call timing, drive simulator |
| `app.js` | Leaflet map, search, route drawing, voice, live navigation screen, settings |
| `sample-route.js` | Synthetic mountain stage with known corners, used for tests and the demo |

## How notes are made

1. The route line is resampled every 5 m. Heading is smoothed over about 8 m so the uneven node spacing in OpenStreetMap data doesn't create false corners. Curvature is the rate of heading change.
2. Corners are stretches tighter than a 400 m radius. Stretches turning the same way less than 20 m apart are merged into one corner. Anything under 12° of total turn is ignored.
3. **Grade** comes from an *effective* radius: the tightest radius plus how much a shallow bend can be straightened using the road width. That is why a short 20° kink is flat but a 90° bend with the same radius is a 3 or 4. The scale runs H (hairpin), 1, 2, 3, 4, 5, 6, from about 50 km/h for a 2 up to about 140 km/h for a 6.
4. **Modifiers**:
   - *tightens* / *opens*: the exit third of the corner is 1.5× tighter or looser than the entry third, and its grade changes.
   - *long*: more than 135° of turn, or more than 150 m long with at least 90° of turn.
   - *don't cut*: every hairpin, and grade-1 corners of 90° or more.
   - *caution*: a grade 2 or tighter after 300 m or more of straight, or a corner that tightens to 2 or tighter.
5. **Gentle bends** that are too open for a 6 are still called, up to a 700 m effective radius: *flat left* if the bend lasts, *kink right* if it is short. Settings → Gentle bends → Skip turns them off, which helps in town.
6. **Junctions** come from OSRM's turn-by-turn steps, but the shape of the call comes from the route itself: the road heading 40 m before the junction compared with 40 m after it. OSRM's own bearings only look at the first few metres of each road, which is how a 35° bear right got called "square".

   | Turn | Call |
   |---|---|
   | under 25° | at junction, keep right |
   | 25–65° | at junction, right 5 (graded like a corner) |
   | 65–120° | at junction, square right |
   | 120–150° | at junction, acute right |
   | over 150° | at junction, hairpin right |

   "T junction", roundabouts, forks and slip roads are called as before. Any geometry corner at the same spot is dropped so it isn't called twice.
7. **Links** between notes: *into* when the next corner is under 20 m away, *and* when it is under 50 m. Otherwise the call gives the distance: rounded to 50 below 175 m, rounded to 100 up to 1 km, then "1 k" / "2 k" / "long straight". Imperial mode uses yards, then "half mile" / "1 mile".

## When calls are spoken

Each call has to finish a set number of seconds before the corner: early 7 s, normal 5 s, late 3.5 s. The trigger distance is therefore `speed × (lead time + estimated speech time) + 15 m`, never less than 60 m and never more than 900 m. Driving faster makes calls come earlier. The co-driver reads ahead: it chains linked notes, and any notes within `max(100 m, 3 s of travel)`, into one breath of up to 4 notes.

If you are more than about 35 m from the route (more if GPS accuracy is poor) for 3 GPS fixes in a row, the app says "Off route, recalculating" and asks OSRM for a new route from where you are to the waypoints you haven't reached yet.

## Circuits (laps)

To make a circuit, tick **Lap circuit** in the Route sheet, or switch the draw bar from **→ One way** to **⟳ Circuit** before you snap the route. The route is then closed back to its start, and the start/finish line becomes the start of each lap.

- **Notes across the start line:** the generator analyses three laps back to back and keeps the middle one. Corners that straddle the start line are measured properly, and the last note of the lap links into the first one.
- **Calls:** the scheduler treats a circuit as a sequence that never ends, so calls keep coming lap after lap.
- **Lap times:** the screen shows the lap number, the current lap time, the last lap and the best lap. Each lap time is spoken, and a new best is called out as "best lap".
- **Going off the circuit:** the app does not reroute. It says "Off route" once and picks the calls up again when you rejoin.

**Cancel route**, in the Route sheet, stops navigation and clears the route.

## Try it without driving

Tap Route → Load demo stage → Start. The Simulate option drives the stage at a capped speed. It slows for corners and speaks the calls.

## Dev

```
npm run rally:notes     # print notes and simulated call timing for the demo stage
npm run test:rally
```

The public OSRM and Nominatim servers are demo services with fair-use limits. For real traffic, host your own instances or use a paid provider.
