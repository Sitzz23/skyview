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
- **Smooth 60 fps motion** interpolated between ~1 Hz fixes (rendered ~1.15 s
  in the past — interpolation between known points, never jittery
  extrapolation)
- **"Window to elsewhere"**: each routed flight shows origin → destination,
  the destination's local time, distance to go, and a faint great-circle arc
- Celestial layer at true positions: sun, moon (with phase), bright stars +
  asterisms (Orion, Big Dipper, Cassiopeia), naked-eye planets, satellites
  and the ISS (with a "next ISS pass" jump in settings)
- Two projections: **Map** (overhead ground plan) and **Sky** (look-up dome —
  zenith at center, horizon at the edge, motion matching what you'd see lying
  outside)
- Themes (ambient / telemetry / focus), live-tunable palette, filters, label
  density — all persisted to localStorage

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
