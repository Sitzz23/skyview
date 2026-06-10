// Aircraft enrichment, all in the browser.
//
// Layer 1 — instant lookups from bundled tables (callsign prefix → airline,
// ICAO type code → human name).
// Layer 2 — adsbdb.com (it sends CORS headers): callsign → route (origin/dest
// + airline) and hex → type/registration. Cached aggressively in localStorage,
// with negative caching, so we stay polite to the free API.
// Adapted from skylight's server-side enrichment (github.com/cpaczek/skylight, MIT).

import airlines from "../data/airlines.json";
import types from "../data/types.json";

const AIRLINES = airlines as Record<string, string>;
const TYPES = types as Record<string, string>;

/** Map an ICAO type code (e.g. "B738") to a human name. */
export function lookupType(code: string | undefined): string | undefined {
  if (!code) return undefined;
  return TYPES[code.toUpperCase()];
}

/**
 * Map a callsign to an airline name via its 3-letter ICAO prefix.
 * Only airline-style callsigns resolve; GA tail numbers (e.g. "N123AB") won't.
 */
export function lookupAirline(callsign: string | undefined): string | undefined {
  if (!callsign) return undefined;
  const cs = callsign.trim().toUpperCase();
  if (cs.length < 4) return undefined;
  const prefix = cs.slice(0, 3);
  // Airline callsigns are LLLdddd: 3 letters then a digit.
  if (!/^[A-Z]{3}$/.test(prefix) || !/\d/.test(cs[3])) return undefined;
  return AIRLINES[prefix];
}

const API = "https://api.adsbdb.com/v0";
const STORAGE_KEY = "skyview.enrich.v1";
const TTL_MS = 12 * 3600_000;
/** At most this many adsbdb requests in the air at once. */
const MAX_CONCURRENT = 4;
/** Keep the cache bounded so localStorage doesn't fill up. */
const MAX_ENTRIES = 1500;

export interface RouteInfo {
  airline?: string;
  origin?: string;
  destination?: string;
  originName?: string;
  destName?: string;
  originLat?: number;
  originLon?: number;
  destLat?: number;
  destLon?: number;
}
export interface AircraftInfo {
  typeName?: string;
  registration?: string;
}
interface CacheEntry<T> {
  data: T | null; // null = looked up, not found (negative cache)
  at: number; // ms epoch
}

interface CacheFile {
  routes: Record<string, CacheEntry<RouteInfo>>;
  aircraft: Record<string, CacheEntry<AircraftInfo>>;
}

export class RouteEnricher {
  private cache: CacheFile = { routes: {}, aircraft: {} };
  private inflight = new Set<string>();
  private queue: (() => Promise<void>)[] = [];
  private active = 0;
  private dirty = false;
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<CacheFile>;
        this.cache = { routes: parsed.routes ?? {}, aircraft: parsed.aircraft ?? {} };
      }
    } catch {
      // first run, no cache yet
    }
    // Persist periodically rather than on every write.
    this.flushTimer = setInterval(() => this.flush(), 15_000);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.flush();
    });
  }

  dispose(): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flush();
  }

  private fresh<T>(e: CacheEntry<T> | undefined, now: number): boolean {
    return !!e && now - e.at < TTL_MS;
  }

  /** Synchronous read of whatever is cached; kicks off a fetch if missing. */
  enrichSync(
    hex: string,
    callsign: string | undefined,
    now: number,
  ): { route?: RouteInfo; aircraft?: AircraftInfo } {
    const out: { route?: RouteInfo; aircraft?: AircraftInfo } = {};

    const ac = this.cache.aircraft[hex];
    if (this.fresh(ac, now)) out.aircraft = ac!.data ?? undefined;
    else this.fetchAircraft(hex);

    if (callsign) {
      const cs = callsign.trim().toUpperCase();
      const r = this.cache.routes[cs];
      if (this.fresh(r, now)) out.route = r!.data ?? undefined;
      else this.fetchRoute(cs);
    }
    return out;
  }

  /** Queue a fetch behind the concurrency cap, deduped by key. */
  private enqueue(key: string, job: () => Promise<void>): void {
    if (this.inflight.has(key)) return;
    this.inflight.add(key);
    this.queue.push(async () => {
      try {
        await job();
      } finally {
        this.inflight.delete(key);
        this.active--;
        this.pump();
      }
    });
    this.pump();
  }

  private pump(): void {
    while (this.active < MAX_CONCURRENT && this.queue.length) {
      const job = this.queue.shift()!;
      this.active++;
      void job();
    }
  }

  private fetchRoute(cs: string): void {
    this.enqueue("r:" + cs, async () => {
      try {
        const res = await fetch(`${API}/callsign/${encodeURIComponent(cs)}`, {
          signal: AbortSignal.timeout(8000),
        });
        let data: RouteInfo | null = null;
        if (res.ok) {
          const json: any = await res.json();
          const fr = json?.response?.flightroute;
          if (fr) {
            data = {
              airline: fr.airline?.name,
              origin: fr.origin?.iata_code ?? fr.origin?.icao_code,
              destination: fr.destination?.iata_code ?? fr.destination?.icao_code,
              originName: fr.origin?.municipality,
              destName: fr.destination?.municipality,
              originLat: fr.origin?.latitude,
              originLon: fr.origin?.longitude,
              destLat: fr.destination?.latitude,
              destLon: fr.destination?.longitude,
            };
          }
        }
        this.cache.routes[cs] = { data, at: Date.now() };
        this.dirty = true;
      } catch {
        // leave uncached so we retry later
      }
    });
  }

  private fetchAircraft(hex: string): void {
    this.enqueue("a:" + hex, async () => {
      try {
        const res = await fetch(`${API}/aircraft/${encodeURIComponent(hex)}`, {
          signal: AbortSignal.timeout(8000),
        });
        let data: AircraftInfo | null = null;
        if (res.ok) {
          const json: any = await res.json();
          const a = json?.response?.aircraft;
          if (a) {
            data = {
              typeName: a.manufacturer && a.type ? `${a.manufacturer} ${a.type}` : a.type,
              registration: a.registration,
            };
          }
        }
        this.cache.aircraft[hex] = { data, at: Date.now() };
        this.dirty = true;
      } catch {
        // retry later
      }
    });
  }

  /** Evict the oldest entries when a section outgrows the cap. */
  private prune<T>(section: Record<string, CacheEntry<T>>): Record<string, CacheEntry<T>> {
    const keys = Object.keys(section);
    if (keys.length <= MAX_ENTRIES) return section;
    keys.sort((a, b) => section[a].at - section[b].at);
    for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) delete section[k];
    return section;
  }

  private flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    try {
      this.cache.routes = this.prune(this.cache.routes);
      this.cache.aircraft = this.prune(this.cache.aircraft);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.cache));
    } catch {
      this.dirty = true; // try again next tick
    }
  }
}
