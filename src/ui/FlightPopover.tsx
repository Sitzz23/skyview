// Right-click popover: everything we know about one flight, anchored to the
// plane and following it across the field. Position is written directly to the
// element by the renderer's frame loop (no React re-render per frame).

import { forwardRef } from "react";
import type { Aircraft } from "../lib/aircraft";
import type { Config } from "../lib/config";
import { formatSpeed } from "../lib/format";
import { llToMeters, metersToMiles, rangeMeters } from "../lib/geo";

const DEG = Math.PI / 180;
const COMPASS = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
];

function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const y = Math.sin((lon2 - lon1) * DEG) * Math.cos(lat2 * DEG);
  const x =
    Math.cos(lat1 * DEG) * Math.sin(lat2 * DEG) -
    Math.sin(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.cos((lon2 - lon1) * DEG);
  return (Math.atan2(y, x) / DEG + 360) % 360;
}

function greatCircleMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const a =
    Math.sin(((lat2 - lat1) * DEG) / 2) ** 2 +
    Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(((lon2 - lon1) * DEG) / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Longitude-based mean solar time, HH:MM (no DST/tz database). */
function localTimeAt(lon: number): string {
  const now = new Date();
  let m = (now.getUTCHours() * 60 + now.getUTCMinutes() + (lon / 15) * 60) % 1440;
  if (m < 0) m += 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.floor(m % 60)).padStart(2, "0")}`;
}

function Field({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="pop-field">
      <span className="pop-key">{label}</span>
      <span className={`pop-val ${warn ? "warn" : ""}`}>{value}</span>
    </div>
  );
}

export const FlightPopover = forwardRef<
  HTMLDivElement,
  { ac: Aircraft; cfg: Config; onClose: () => void }
>(function FlightPopover({ ac, cfg, onClose }, ref) {
  const alt = ac.altBaro ?? ac.altGeom;
  const emergency = !!ac.squawk && ["7500", "7600", "7700"].includes(ac.squawk);

  const fields: { label: string; value: string; warn?: boolean }[] = [];
  const add = (label: string, value: string | undefined | null, warn = false) => {
    if (value) fields.push({ label, value, warn });
  };

  add("Airline", ac.airline);
  add(
    "Aircraft",
    ac.typeName ? (ac.typeCode ? `${ac.typeName} (${ac.typeCode})` : ac.typeName) : ac.typeCode,
  );
  add("Registration", ac.registration);
  add("ICAO hex", ac.hex.toUpperCase());
  add("Category", ac.category);
  add("Squawk", emergency ? `${ac.squawk} — EMERGENCY` : ac.squawk, emergency);

  if (ac.onGround) add("Altitude", "on ground");
  else if (alt != null) {
    const geom = ac.altGeom != null && ac.altGeom !== alt ? ` (${ac.altGeom.toLocaleString("en-US")} ft GPS)` : "";
    add("Altitude", `${alt.toLocaleString("en-US")} ft${geom}`);
  }
  if (ac.baroRate != null && ac.baroRate !== 0) {
    add("Vertical rate", `${ac.baroRate > 0 ? "+" : ""}${ac.baroRate.toLocaleString("en-US")} ft/min ${ac.baroRate > 0 ? "↑" : "↓"}`);
  }
  if (ac.gs != null) add("Ground speed", formatSpeed(ac.gs, cfg.speedUnit));
  if (ac.track != null) add("Track", `${Math.round(ac.track)}° ${COMPASS[Math.round(ac.track / 22.5) % 16]}`);

  if (ac.lat != null && ac.lon != null) {
    add("Position", `${ac.lat.toFixed(4)}, ${ac.lon.toFixed(4)}`);
    const mi = metersToMiles(rangeMeters(llToMeters(ac.lat, ac.lon, cfg.centerLat, cfg.centerLon)));
    const brg = bearingDeg(cfg.centerLat, cfg.centerLon, ac.lat, ac.lon);
    add("From you", `${mi.toFixed(1)} mi ${COMPASS[Math.round(brg / 22.5) % 16]}`);
  }

  if (ac.origin || ac.destination) {
    const route = `${ac.origin ?? "?"} → ${ac.destination ?? "?"}`;
    const cities = [ac.originName, ac.destName].filter(Boolean).join(" → ");
    add("Route", cities ? `${route}   ${cities}` : route);
    if (ac.destLat != null && ac.destLon != null && ac.lat != null && ac.lon != null) {
      const togo = Math.round(greatCircleMiles(ac.lat, ac.lon, ac.destLat, ac.destLon));
      add("To destination", `${togo.toLocaleString("en-US")} mi · ${localTimeAt(ac.destLon)} local`);
    }
  }
  if (ac.seen != null) add("Last message", ac.seen < 1 ? "just now" : `${Math.round(ac.seen)} s ago`);

  return (
    <div ref={ref} className="flight-popover" role="dialog" aria-label="Flight details">
      <div className="pop-head">
        <div>
          <div className="pop-title">{ac.flight ?? ac.registration ?? ac.hex.toUpperCase()}</div>
          {ac.airline && <div className="pop-sub">{ac.airline}</div>}
        </div>
        <button className="pop-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="pop-grid">
        {fields.map((f) => (
          <Field key={f.label} label={f.label} value={f.value} warn={f.warn} />
        ))}
      </div>
      <div className="pop-links">
        <a
          href={`https://globe.airplanes.live/?icao=${ac.hex}`}
          target="_blank"
          rel="noreferrer"
        >
          airplanes.live ↗
        </a>
        {ac.flight && (
          <a
            href={`https://www.flightaware.com/live/flight/${encodeURIComponent(ac.flight)}`}
            target="_blank"
            rel="noreferrer"
          >
            FlightAware ↗
          </a>
        )}
      </div>
    </div>
  );
});
