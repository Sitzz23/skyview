// Display formatting helpers shared between the display renderer and any HUD.
// Adapted from skylight (github.com/cpaczek/skylight, MIT).

import type { SpeedUnit } from "./config";

const KT_TO_MPH = 1.15078;
const KT_TO_KMH = 1.852;

const SPEED_SUFFIX: Record<SpeedUnit, string> = {
  kt: "kt",
  mph: "mph",
  kmh: "km/h",
};

/** Convert a ground speed in knots (as ADS-B reports it) to the chosen unit. */
export function convertSpeed(gsKnots: number, unit: SpeedUnit): number {
  switch (unit) {
    case "mph":
      return gsKnots * KT_TO_MPH;
    case "kmh":
      return gsKnots * KT_TO_KMH;
    default:
      return gsKnots;
  }
}

/** Format a ground speed (knots in) as a rounded, unit-suffixed string. */
export function formatSpeed(gsKnots: number, unit: SpeedUnit): string {
  return `${Math.round(convertSpeed(gsKnots, unit))} ${SPEED_SUFFIX[unit]}`;
}
