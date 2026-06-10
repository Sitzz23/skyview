# Skyview

The aircraft moving through the sky around you, live, as a luminous night-sky
radar — a pure-website adaptation of
[Skylight](https://github.com/cpaczek/skylight) by cpaczek (MIT), which
projects this onto a ceiling from an RTL-SDR. Skyview keeps the aesthetic and
motion model but needs no hardware and no server: the browser talks to the
public APIs directly.

## Features

- **Live aircraft in your radius** — pick your location (geolocation or
  search), adjust the radius 1–50 mi from the settings drawer or with `[` / `]`
- Skylight's visual language: pure black, altitude-graded luminous glyphs
  (amber low → teal → near-white high), comet trails, whisper-quiet range
  rings and compass
- Type-aware silhouettes: widebodies read bigger, helicopters spin their
  rotors, turboprops and Cessnas spin their props
- **Smooth motion at display refresh rate**, interpolated between real fixes.
  The renderer draws the world a couple of seconds in the past and *adapts*
  that delay to the measured fix cadence (network RTT, receiver coverage,
  dropped polls), so it almost always interpolates between two known points.
  When a correction is unavoidable, it's blended in over ~350 ms — planes
  glide, they never snap. Positions on screen run ~2–4 s behind reality by
  design; that's the price of jitter-free ambient motion.
- **"Window to elsewhere"**: each routed flight shows origin → destination,
  the destination's local time, distance to go, and a faint great-circle arc
- Celestial layer at true positions: sun, moon (with phase), bright stars +
  asterisms (Orion, Big Dipper, Cassiopeia), naked-eye planets, satellites
  and the ISS (with a "next ISS pass" jump in settings)
- Two projections: **Map** (overhead ground plan) and **Sky** (look-up dome —
  zenith at center, horizon at the edge, motion matching what you'd see lying
  outside)
- **Right-click any plane** for a details popover that follows it: airline,
  type, registration, squawk, altitudes, vertical rate, speed, track, position,
  distance/bearing from you, route with cities, distance-to-go and destination
  local time, plus airplanes.live / FlightAware links
- Themes (ambient / telemetry / focus), live-tunable palette, filters, label
  density — all persisted to localStorage

## Performance

Built to idle on anything: glyph bodies (the shadow-bloom part) are
pre-rendered into a sprite cache so each plane is one rotated `drawImage` per
frame; the celestial layer renders to an offscreen canvas refreshed every
~150 ms; rings/compass/runways re-render only when the view changes; the
astronomy/orbital libraries load lazily in a separate chunk; label measurement
is memoized and invisible trail segments are skipped. Measured: ~0.8 ms/frame
with a handful of aircraft, ~1.9 ms/frame with 150 — ≈11% of a 60 fps budget.
Polling pauses while the tab is hidden and backs off on API errors.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/ — deploy anywhere
```

No API keys, no backend. Deploy `dist/` to any static host (GitHub Pages,
Netlify, Cloudflare Pages).

## Keyboard

| Key | Action |
| --- | --- |
| `s` | settings drawer |
| `[` / `]` | radius −/+ 1 mi |
| `p` | toggle map / sky projection |
| `t` | cycle theme |
| `h` | status HUD |
| `Esc` | close drawer / popover |

Right-click a plane → full flight details. Left-click the sky to dismiss.

## Data sources

- [airplanes.live](https://airplanes.live) — aircraft positions (polled ~1 Hz,
  backs off when rate-limited, pauses when the tab is hidden)
- [adsbdb.com](https://www.adsbdb.com) — callsign → route, hex → type/registration
  (cached 12 h in localStorage, negative-cached, max 4 concurrent lookups)
- [CelesTrak](https://celestrak.org) — satellite TLEs (cached 6 h)
- [Nominatim](https://nominatim.openstreetmap.org) — location search

Be a good citizen: these are free community services.

## Credits

Rendering, glyph art, projection math, and the celestial layer are adapted
from [Skylight](https://github.com/cpaczek/skylight) by Cameron Paczek,
MIT-licensed. Skyview swaps its server + WebSocket pipeline for an in-browser
poller and localStorage persistence.
