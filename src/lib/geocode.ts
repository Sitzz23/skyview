// Place lookup for the location box: a raw "lat, lon" pair resolves locally,
// anything else goes to Nominatim (OpenStreetMap's geocoder, CORS-friendly).

import { formatLatLon } from "./geo";

export interface GeocodeHit {
  lat: number;
  lon: number;
  name: string;
}

const NOMINATIM = "https://nominatim.openstreetmap.org/search";

export async function geocode(query: string): Promise<GeocodeHit | null> {
  const q = query.trim();
  if (!q) return null;

  // "37.62, -122.38" style input — no network needed.
  const m = q.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (m) {
    const lat = Number(m[1]);
    const lon = Number(m[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      return { lat, lon, name: formatLatLon(lat, lon) };
    }
    return null;
  }

  const url = `${NOMINATIM}?q=${encodeURIComponent(q)}&format=jsonv2&limit=1`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(10000),
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const hits = (await res.json()) as { lat: string; lon: string; display_name: string }[];
  if (!hits.length) return null;
  const hit = hits[0];
  // display_name is long ("SFO, San Mateo County, California, …"); keep it short.
  const name = hit.display_name.split(",").slice(0, 2).join(",").trim();
  return { lat: Number(hit.lat), lon: Number(hit.lon), name };
}
