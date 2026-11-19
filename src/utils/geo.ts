export type LngLat = readonly [lng: number, lat: number];
/** [west, south, east, north], the same order MapLibre's `fitBounds` takes. */
export type Bounds = [number, number, number, number];

export const EARTH_RADIUS_M = 6_371_008.8;
export const DEG = Math.PI / 180;

export function haversineM(a: LngLat, b: LngLat): number {
  const dLat = (b[1] - a[1]) * DEG;
  const dLng = (b[0] - a[0]) * DEG;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * DEG) * Math.cos(b[1] * DEG) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Smallest absolute difference between two compass bearings, 0..180. */
export function angleDiffDeg(a: number, b: number): number {
  return Math.abs((((a - b) % 360) + 540) % 360 - 180);
}

/** Compass bearing from a to b (0 = north, clockwise), flat-earth approximation. */
export function bearingDeg(a: LngLat, b: LngLat): number {
  const dx = (b[0] - a[0]) * Math.cos(((a[1] + b[1]) / 2) * DEG);
  const dy = b[1] - a[1];
  return (Math.atan2(dx, dy) / DEG + 360) % 360;
}

export interface SegmentProjection {
  /** Perpendicular (clamped to the segment) distance from the point, metres. */
  distanceM: number;
  /** Position of the closest point along the segment, 0..1. */
  t: number;
}

/** Perpendicular projection of `p` onto segment a-b, in a local flat projection around `p`. */
export function projectOnSegment(p: LngLat, a: LngLat, b: LngLat): SegmentProjection {
  const kx = DEG * EARTH_RADIUS_M * Math.cos(p[1] * DEG);
  const ky = DEG * EARTH_RADIUS_M;
  const ax = (a[0] - p[0]) * kx;
  const ay = (a[1] - p[1]) * ky;
  const dx = (b[0] - p[0]) * kx - ax;
  const dy = (b[1] - p[1]) * ky - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2));
  return { distanceM: Math.hypot(ax + t * dx, ay + t * dy), t };
}

export function pathLengthM(points: readonly LngLat[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += haversineM(points[i - 1], points[i]);
  return total;
}

/** Bounding box of a set of points, or null when empty. */
export function boundsOf(points: readonly LngLat[]): Bounds | null {
  if (points.length === 0) return null;
  let west = points[0][0];
  let east = west;
  let south = points[0][1];
  let north = south;
  for (const [lng, lat] of points) {
    if (lng < west) west = lng;
    if (lng > east) east = lng;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  return [west, south, east, north];
}
