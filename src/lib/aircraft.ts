// Normalized aircraft model. The poller maps airplanes.live API records into
// this single shape so the renderer never cares where the data came from.
// Adapted from skylight (github.com/cpaczek/skylight, MIT).

export interface Aircraft {
  /** 24-bit ICAO address — the stable key for everything. */
  hex: string;
  /** Callsign, trimmed (e.g. "UAL1234"). */
  flight?: string;

  lat?: number;
  lon?: number;
  /** Barometric altitude in feet, or null when on ground. */
  altBaro?: number | null;
  /** Geometric altitude in feet. */
  altGeom?: number | null;
  /** Ground speed, knots. */
  gs?: number;
  /** Track / heading over ground, degrees. */
  track?: number;
  /** Vertical rate, ft/min (positive = climbing). */
  baroRate?: number | null;
  squawk?: string;
  category?: string;
  onGround?: boolean;

  /** Registration. */
  registration?: string;
  /** ICAO type code, e.g. "B738". */
  typeCode?: string;

  /** Seconds since the last message for this aircraft (from the source). */
  seen?: number;

  // --- enrichment ---
  /** Human type name, e.g. "Boeing 737-800". */
  typeName?: string;
  airline?: string;
  origin?: string;
  destination?: string;
  /** Destination/origin city + coordinates (for ghost arcs + local time). */
  originName?: string;
  destName?: string;
  originLat?: number;
  originLon?: number;
  destLat?: number;
  destLon?: number;

  /** Timestamp (ms) of the snapshot this fix came from. */
  ts?: number;
}
