// Wind direction helpers.
//
// Bearings are degrees the wind blows *from* (meteorological convention, 0 = north).
// Averaging them needs unit vectors: 350° and 10° average to 0°, not 180°.

const CARDINALS = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
];

const CARDINAL_NAMES = {
  N: 'north',
  NNE: 'north-northeast',
  NE: 'northeast',
  ENE: 'east-northeast',
  E: 'east',
  ESE: 'east-southeast',
  SE: 'southeast',
  SSE: 'south-southeast',
  S: 'south',
  SSW: 'south-southwest',
  SW: 'southwest',
  WSW: 'west-southwest',
  W: 'west',
  WNW: 'west-northwest',
  NW: 'northwest',
  NNW: 'north-northwest',
};

/** Wrap any bearing into [0, 360). */
export function normalizeDegrees(value) {
  if (!Number.isFinite(value)) return null;
  const wrapped = value % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/** Smallest angle between two bearings, 0–180. */
export function angularDistance(a, b) {
  const left = normalizeDegrees(a);
  const right = normalizeDegrees(b);
  if (left === null || right === null) return null;
  const difference = Math.abs(left - right);
  return difference > 180 ? 360 - difference : difference;
}

/**
 * Circular mean of bearings. Returns null when there are no values or when the
 * directions cancel out (the wind veered around the whole compass).
 */
export function meanDirection(degrees) {
  const usable = (degrees ?? []).filter(Number.isFinite);
  if (!usable.length) return null;

  let x = 0;
  let y = 0;
  for (const degreesValue of usable) {
    const radians = (normalizeDegrees(degreesValue) * Math.PI) / 180;
    x += Math.cos(radians);
    y += Math.sin(radians);
  }
  // A near-zero resultant vector means the directions are not comparable.
  if (Math.hypot(x, y) < 1e-6) return null;

  return normalizeDegrees((Math.atan2(y, x) * 180) / Math.PI);
}

/** Largest deviation from the mean bearing; null with fewer than two values. */
export function directionSpread(degrees) {
  const usable = (degrees ?? []).filter(Number.isFinite);
  if (usable.length < 2) return null;
  const mean = meanDirection(usable);
  if (mean === null) return null;
  return usable.reduce((widest, value) => Math.max(widest, angularDistance(value, mean)), 0);
}

/** 16-point compass abbreviation for a bearing, e.g. 292.5 → "WNW". */
export function cardinal(degrees) {
  const bearing = normalizeDegrees(degrees);
  if (bearing === null) return null;
  return CARDINALS[Math.round(bearing / 22.5) % CARDINALS.length];
}

/** Spoken compass name, used for labels and screen-reader text. */
export function cardinalName(degrees) {
  const point = cardinal(degrees);
  return point ? CARDINAL_NAMES[point] : null;
}

/** Convert a compass point ("NW", "nne") to its bearing in degrees. */
export function compassToDegrees(point) {
  if (typeof point !== 'string') return null;
  const index = CARDINALS.indexOf(point.trim().toUpperCase());
  return index === -1 ? null : index * 22.5;
}
