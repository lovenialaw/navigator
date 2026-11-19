import type { KeyValueStore } from '../storage/keyValueStore';
import { plannedRouteSchema, type PlannedRoute } from './routeTypes';

export const ACTIVE_ROUTE_KEY = 'tuju.route.active.v1';
export const ROUTE_CANDIDATES_KEY = 'tuju.route.candidates.v1';

function readRoutes(store: KeyValueStore, key: string): PlannedRoute[] | null {
  const raw = store.getString(key);
  if (!raw) return null;
  try {
    const json: unknown = JSON.parse(raw);
    const list: unknown[] = Array.isArray(json) ? json : [json];
    const routes: PlannedRoute[] = [];
    for (const item of list) {
      const parsed = plannedRouteSchema.safeParse(item);
      if (!parsed.success) throw new Error('invalid stored route');
      routes.push(parsed.data);
    }
    if (routes.length === 0) throw new Error('empty stored routes');
    return routes;
  } catch {
    // Corrupt or from an older schema: drop it rather than crash a cold launch.
    store.remove(key);
    return null;
  }
}

/**
 * Persists the route that guidance follows. Written synchronously the moment a route
 * is fetched, so turn-by-turn data survives going offline or the app being killed.
 */
export function saveActiveRoute(store: KeyValueStore, route: PlannedRoute): void {
  store.set(ACTIVE_ROUTE_KEY, JSON.stringify(route));
}

export function loadActiveRoute(store: KeyValueStore): PlannedRoute | null {
  return readRoutes(store, ACTIVE_ROUTE_KEY)?.[0] ?? null;
}

export function clearActiveRoute(store: KeyValueStore): void {
  store.remove(ACTIVE_ROUTE_KEY);
}

export function saveRouteCandidates(store: KeyValueStore, routes: readonly PlannedRoute[]): void {
  store.set(ROUTE_CANDIDATES_KEY, JSON.stringify(routes));
}

export function loadRouteCandidates(store: KeyValueStore): PlannedRoute[] {
  return readRoutes(store, ROUTE_CANDIDATES_KEY) ?? [];
}

export function clearRouteCandidates(store: KeyValueStore): void {
  store.remove(ROUTE_CANDIDATES_KEY);
}
