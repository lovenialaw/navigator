import { projectOntoRoute } from '../poi/alongRoute';
import { MAX_WAYPOINTS, type Place } from '../routing/routeTypes';
import type { RouteGeometry } from '../utils/mapMatcher';

/** A stop this close behind the vehicle counts as reached. */
export const STOP_REACHED_MARGIN_M = 30;

/** Sorts stops into the order the route reaches them. */
export function orderStops(geometry: RouteGeometry, stops: readonly Place[]): Place[] {
  return stops
    .map((stop) => ({ stop, alongM: projectOntoRoute(geometry, [stop.lng, stop.lat])?.alongM ?? 0 }))
    .sort((a, b) => a.alongM - b.alongM)
    .map((entry) => entry.stop);
}

/** Stops on the route the driver has not reached yet. Those already passed must not be re-added by a re-route. */
export function remainingStops(geometry: RouteGeometry, stops: readonly Place[], alongM: number): Place[] {
  return orderStops(
    geometry,
    stops.filter((stop) => {
      const hit = projectOntoRoute(geometry, [stop.lng, stop.lat]);
      return hit === null || hit.alongM > alongM + STOP_REACHED_MARGIN_M;
    }),
  );
}

export type StopChange = { ok: true; stops: Place[] } | { ok: false; reason: string };

/** Adds a stop (single tap) keeping the final destination untouched. Order is by position on the route. */
export function withStop(
  geometry: RouteGeometry,
  current: readonly Place[],
  alongM: number,
  stop: Place,
): StopChange {
  const ahead = remainingStops(geometry, current, alongM);
  if (ahead.some((s) => s.id === stop.id)) return { ok: false, reason: `${stop.name} is already a stop.` };
  if (ahead.length >= MAX_WAYPOINTS) return { ok: false, reason: `You can add up to ${MAX_WAYPOINTS} stops.` };
  return { ok: true, stops: orderStops(geometry, [...ahead, stop]) };
}
