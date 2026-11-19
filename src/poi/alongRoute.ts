/**
 * Pure helpers that place POIs and alerts on the active route and answer "how far ahead
 * is the next one". No React, no storage, no network.
 */
import { DEG, EARTH_RADIUS_M, projectOnSegment, type LngLat } from '../utils/geo';
import type { RouteGeometry } from '../utils/mapMatcher';
import { CORRIDOR_RADIUS_M } from './overpassClient';
import type { Alert } from '../alerts/alertTypes';
import type { Poi, PoiKind, RoutePoi } from './poiTypes';

export interface RouteProjection {
  /** Metres from the route start to the closest point on the route. */
  alongM: number;
  /** Straight-line distance from the point to the route, metres. */
  offsetM: number;
}

/** R&Rs sit beside the carriageway, so a far-off hit is a different road. Fuel and EV can be in a town off an exit. */
export const MAX_OFFSET_M: Record<PoiKind, number> = { rnr: 800, fuel: CORRIDOR_RADIUS_M, ev: CORRIDOR_RADIUS_M };

/** Closest point of the route to `point`, or null when it is farther than `maxOffsetM`. */
export function projectOntoRoute(
  geometry: RouteGeometry,
  point: LngLat,
  maxOffsetM = Number.POSITIVE_INFINITY,
): RouteProjection | null {
  const { shape, cumulativeM } = geometry;
  const finite = Number.isFinite(maxOffsetM);
  // Cheap reject box in degrees so a 300 km route does not run trig on every segment.
  const latPad = (maxOffsetM / EARTH_RADIUS_M) / DEG;
  const lngPad = latPad / Math.max(0.2, Math.cos(point[1] * DEG));

  let best: RouteProjection | null = null;
  for (let i = 0; i < shape.length - 1; i += 1) {
    const a = shape[i];
    const b = shape[i + 1];
    if (finite) {
      if (point[0] < Math.min(a[0], b[0]) - lngPad || point[0] > Math.max(a[0], b[0]) + lngPad) continue;
      if (point[1] < Math.min(a[1], b[1]) - latPad || point[1] > Math.max(a[1], b[1]) + latPad) continue;
    }
    const projection = projectOnSegment(point, a, b);
    if (best === null || projection.distanceM < best.offsetM) {
      best = {
        offsetM: projection.distanceM,
        alongM: cumulativeM[i] + projection.t * (cumulativeM[i + 1] - cumulativeM[i]),
      };
    }
  }
  return best !== null && best.offsetM <= maxOffsetM ? best : null;
}

/** Every POI close enough to the route, sorted by distance from the start. */
export function locatePois(geometry: RouteGeometry, pois: readonly Poi[]): RoutePoi[] {
  const located: RoutePoi[] = [];
  for (const poi of pois) {
    const hit = projectOntoRoute(geometry, [poi.lng, poi.lat], MAX_OFFSET_M[poi.kind]);
    if (hit) located.push({ ...poi, alongM: hit.alongM, offsetM: hit.offsetM });
  }
  return located.sort((a, b) => a.alongM - b.alongM);
}

/** The next `count` items of one kind still ahead of the vehicle, nearest first. */
export function nextAhead<T extends { alongM: number }>(items: readonly T[], alongM: number, count = 3): T[] {
  const ahead: T[] = [];
  for (const item of items) {
    if (item.alongM > alongM) {
      ahead.push(item);
      if (ahead.length >= count) break;
    }
  }
  return ahead;
}

export interface RouteAlert extends Alert {
  /** Where the route enters the alert area, metres from the start. */
  enterM: number;
  /** Where the route leaves it. */
  exitM: number;
  offsetM: number;
}

/**
 * Alerts whose area the route crosses. The route crosses a circle of radius r at offset
 * d along a chord of half-length sqrt(r^2 - d^2) centred on the projection.
 */
export function locateAlerts(geometry: RouteGeometry, alerts: readonly Alert[]): RouteAlert[] {
  const located: RouteAlert[] = [];
  for (const alert of alerts) {
    const hit = projectOntoRoute(geometry, [alert.lng, alert.lat], alert.radiusM);
    if (!hit) continue;
    const half = Math.sqrt(Math.max(0, alert.radiusM ** 2 - hit.offsetM ** 2));
    located.push({
      ...alert,
      offsetM: hit.offsetM,
      enterM: Math.max(0, hit.alongM - half),
      exitM: hit.alongM + half,
    });
  }
  return located.sort((a, b) => a.enterM - b.enterM);
}

/** Alerts not yet driven through: either ahead or the vehicle is inside one right now. */
export function alertsAhead(alerts: readonly RouteAlert[], alongM: number, count = 3): RouteAlert[] {
  return alerts.filter((a) => a.exitM > alongM).slice(0, count);
}

/** Metres until the alert area starts; 0 while inside it. */
export function distanceToAlertM(alert: RouteAlert, alongM: number): number {
  return Math.max(0, alert.enterM - alongM);
}

/**
 * True when every point of `shape` is within `toleranceM` of `corridor`, so POIs fetched
 * for the old route still cover the new one (a re-route or an added stop).
 */
export function corridorCovers(corridor: RouteGeometry, shape: readonly LngLat[], toleranceM: number): boolean {
  return shape.every((point) => projectOntoRoute(corridor, point, toleranceM) !== null);
}
