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
5. **Junctions** come from OSRM's turn-by-turn steps, for example "at junction, square right", "T junction, hairpin left", "roundabout, second exit", "fork, keep left". Any geometry corner at the same spot is dropped so it isn't called twice.
6. **Links** between notes: *into* when the next corner is under 20 m away, *and* when it is under 50 m. Otherwise the call gives the distance: rounded to 50 below 175 m, rounded to 100 up to 1 km, then "1 k" / "2 k" / "long straight". Imperial mode uses yards, then "half mile" / "1 mile".

## When calls are spoken

Each call has to finish a set number of seconds before the corner: early 7 s, normal 5 s, late 3.5 s. The trigger distance is therefore `speed × (lead time + estimated speech time) + 15 m`, never less than 60 m and never more than 900 m. Driving faster makes calls come earlier. The co-driver reads ahead: it chains linked notes, and any notes within `max(100 m, 3 s of travel)`, into one breath of up to 4 notes.

If you are more than about 35 m from the route (more if GPS accuracy is poor) for 3 GPS fixes in a row, the app says "Off route, recalculating" and asks OSRM for a new route from where you are to the waypoints you haven't reached yet.

## Try it without driving

Tap Route → Load demo stage → Start. The Simulate option drives the stage at a capped speed. It slows for corners and speaks the calls.

## Dev

```
npm run rally:notes     # print notes and simulated call timing for the demo stage
npm run test:rally
```

The public OSRM and Nominatim servers are demo services with fair-use limits. For real traffic, host your own instances or use a paid provider.
