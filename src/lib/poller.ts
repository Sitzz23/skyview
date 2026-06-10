// Data acquisition, all in the browser: poll airplanes.live (it sends CORS
// headers) for aircraft within the configured radius, normalize records into
// our Aircraft shape, enrich them, and emit snapshots.
// Adapted from skylight's server-side poller (github.com/cpaczek/skylight, MIT).

import type { Aircraft } from "./aircraft";
import type { Config } from "./config";
import { lookupAirline, lookupType } from "./enrich";
import { RouteEnricher } from "./enrich";

const API_TEMPLATE = "https://api.airplanes.live/v2/point/{lat}/{lon}/{r}";
const NM_PER_MILE = 0.868976;
/** airplanes.live asks for at most ~1 request/second. */
const POLL_MS = 1000;
/** Back off up to this much after consecutive failures (e.g. rate limited). */
const MAX_BACKOFF_MS = 15_000;

export interface SourceStatus {
  ok: boolean;
  count: number;
  lastOk: number | null;
  message?: string;
}

/** Raw readsb-style aircraft record (subset we use). */
interface RawAircraft {
  hex?: string;
  flight?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | "ground";
  alt_geom?: number;
  gs?: number;
  track?: number;
  baro_rate?: number;
  squawk?: string;
  category?: string;
  r?: string;
  t?: string;
  seen?: number;
}

function normalize(raw: RawAircraft, ts: number): Aircraft | null {
  if (!raw.hex) return null;
  const onGround = raw.alt_baro === "ground";
  return {
    hex: raw.hex,
    flight: raw.flight?.trim() || undefined,
    lat: raw.lat,
    lon: raw.lon,
    altBaro: onGround ? null : ((raw.alt_baro as number | undefined) ?? null),
    altGeom: raw.alt_geom ?? null,
    gs: raw.gs,
    track: raw.track,
    baroRate: raw.baro_rate ?? null,
    squawk: raw.squawk,
    category: raw.category,
    onGround,
    registration: raw.r,
    typeCode: raw.t,
    seen: raw.seen,
    ts,
  };
}

/** Enrichment we've resolved for an aircraft, kept sticky for its session. */
interface StickyEnrichment {
  typeName?: string;
  airline?: string;
  origin?: string;
  destination?: string;
  registration?: string;
  originName?: string;
  destName?: string;
  originLat?: number;
  originLon?: number;
  destLat?: number;
  destLon?: number;
  lastSeen: number;
}

export interface PollerOptions {
  getConfig: () => Config;
  onSnapshot: (now: number, aircraft: Aircraft[]) => void;
  onStatus: (status: SourceStatus) => void;
}

export class Poller {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private fails = 0;
  private status: SourceStatus = { ok: false, count: 0, lastOk: null };
  private enricher = new RouteEnricher();
  /** hex -> last good enrichment, so resolved routes never flicker back to "—". */
  private sticky = new Map<string, StickyEnrichment>();

  constructor(private o: PollerOptions) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.enricher.dispose();
  }

  private schedule(): void {
    if (!this.running) return;
    const backoff = this.fails ? Math.min(MAX_BACKOFF_MS, POLL_MS * 2 ** this.fails) : POLL_MS;
    this.timer = setTimeout(() => void this.tick(), backoff);
  }

  private buildUrl(): string {
    const c = this.o.getConfig();
    const r = Math.min(250, Math.ceil(c.radiusMiles * NM_PER_MILE) + 1);
    return API_TEMPLATE.replace("{lat}", String(c.centerLat))
      .replace("{lon}", String(c.centerLon))
      .replace("{r}", String(r));
  }

  private async tick(): Promise<void> {
    if (!this.running) return;
    // Don't burn API quota while the tab is hidden — the renderer is paused
    // anyway. Check again shortly; resume polling the moment we're visible.
    if (document.hidden) {
      this.timer = setTimeout(() => void this.tick(), 2000);
      return;
    }
    const now = Date.now();
    try {
      const res = await fetch(this.buildUrl(), { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: any = await res.json();
      const rawList: RawAircraft[] = json.ac ?? json.aircraft ?? [];
      const list: Aircraft[] = [];
      for (const raw of rawList) {
        const ac = normalize(raw, now);
        if (ac) list.push(ac);
      }
      for (const ac of list) this.enrich(ac, now);
      this.pruneSticky(now);
      this.fails = 0;
      this.status = { ok: true, count: list.length, lastOk: now };
      this.o.onSnapshot(now, list);
      this.o.onStatus(this.status);
    } catch (err) {
      this.fails = Math.min(this.fails + 1, 4);
      this.status = {
        ...this.status,
        ok: false,
        message: err instanceof Error ? err.message : "fetch failed",
      };
      this.o.onStatus(this.status);
    }
    this.schedule();
  }

  private enrich(ac: Aircraft, now: number): void {
    // Instant table lookups first.
    ac.typeName = lookupType(ac.typeCode);
    ac.airline = lookupAirline(ac.flight);

    // adsbdb fills gaps (route + better type), from cache when available.
    const e = this.enricher.enrichSync(ac.hex, ac.flight, now);
    if (e.route) {
      ac.airline = ac.airline ?? e.route.airline;
      ac.origin = e.route.origin ?? ac.origin;
      ac.destination = e.route.destination ?? ac.destination;
      ac.originName = e.route.originName ?? ac.originName;
      ac.destName = e.route.destName ?? ac.destName;
      ac.originLat = e.route.originLat ?? ac.originLat;
      ac.originLon = e.route.originLon ?? ac.originLon;
      ac.destLat = e.route.destLat ?? ac.destLat;
      ac.destLon = e.route.destLon ?? ac.destLon;
    }
    if (e.aircraft) {
      ac.typeName = ac.typeName ?? e.aircraft.typeName;
      ac.registration = ac.registration ?? e.aircraft.registration;
    }

    // Sticky merge: once we've resolved something for this hex, never drop it
    // back to undefined on a later snapshot (prevents label flicker).
    const prev = this.sticky.get(ac.hex);
    ac.typeName = ac.typeName ?? prev?.typeName;
    ac.airline = ac.airline ?? prev?.airline;
    ac.origin = ac.origin ?? prev?.origin;
    ac.destination = ac.destination ?? prev?.destination;
    ac.registration = ac.registration ?? prev?.registration;
    ac.originName = ac.originName ?? prev?.originName;
    ac.destName = ac.destName ?? prev?.destName;
    ac.originLat = ac.originLat ?? prev?.originLat;
    ac.originLon = ac.originLon ?? prev?.originLon;
    ac.destLat = ac.destLat ?? prev?.destLat;
    ac.destLon = ac.destLon ?? prev?.destLon;
    this.sticky.set(ac.hex, {
      typeName: ac.typeName,
      airline: ac.airline,
      origin: ac.origin,
      destination: ac.destination,
      registration: ac.registration,
      originName: ac.originName,
      destName: ac.destName,
      originLat: ac.originLat,
      originLon: ac.originLon,
      destLat: ac.destLat,
      destLon: ac.destLon,
      lastSeen: now,
    });
  }

  /** Drop sticky entries for aircraft long gone (keep the map small). */
  private pruneSticky(now: number): void {
    for (const [hex, s] of this.sticky) {
      if (now - s.lastSeen > 600_000) this.sticky.delete(hex);
    }
  }
}
