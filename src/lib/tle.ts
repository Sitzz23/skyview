// Satellite TLEs (Two-Line Elements) fetched straight from Celestrak (it sends
// CORS headers), parsed, and cached in localStorage so reloads don't re-hit the
// service. The "visual" group is the set of satellites bright enough to see.

import type { Tle } from "./celestial";

const TLE_URL = "https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=tle";
const STORAGE_KEY = "skyview.tle.v1";
const TTL_MS = 6 * 3600_000;

interface TleCache {
  at: number;
  tles: Tle[];
}

function parseTle(text: string): Tle[] {
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd());
  const out: Tle[] = [];
  for (let i = 0; i + 2 < lines.length + 1; i++) {
    const name = lines[i];
    const l1 = lines[i + 1];
    const l2 = lines[i + 2];
    if (name && l1?.startsWith("1 ") && l2?.startsWith("2 ")) {
      out.push({ name: name.trim(), line1: l1, line2: l2 });
      i += 2;
    }
  }
  return out;
}

function readCache(): TleCache | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as TleCache;
  } catch {
    return null;
  }
}

let inflight: Promise<Tle[]> | null = null;

/** Cached TLE set; refreshes from Celestrak when stale. Never throws. */
export function getTles(): Promise<Tle[]> {
  const cached = readCache();
  if (cached && Date.now() - cached.at < TTL_MS) return Promise.resolve(cached.tles);
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch(TLE_URL, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const tles = parseTle(await res.text());
      if (tles.length) {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ at: Date.now(), tles }));
        } catch {
          // cache full — satellites still work this session
        }
        return tles;
      }
      return cached?.tles ?? [];
    } catch {
      return cached?.tles ?? []; // stale beats nothing
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
