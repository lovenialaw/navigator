import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { KeyValueStore } from '../storage/keyValueStore';
import { getOrigin, type Origin } from './origin';
import {
  clearActiveRoute,
  clearRouteCandidates,
  loadActiveRoute,
  loadRouteCandidates,
  saveActiveRoute,
  saveRouteCandidates,
} from './routeStore';
import type { Place, PlannedRoute, RouteProfile } from './routeTypes';
import { planRoutes } from './valhallaClient';
import { ValhallaCache } from './valhallaCache';

export type PlannerStatus = 'idle' | 'locating' | 'planning' | 'ready' | 'error';

export interface RoutePlannerState {
  status: PlannerStatus;
  destination: Place | null;
  origin: Origin | null;
  routes: PlannedRoute[];
  /** The route guidance follows. Always the one persisted in MMKV. */
  active: PlannedRoute | null;
  mock: boolean;
  failedProfiles: RouteProfile[];
  error: string | null;
  sheetOpen: boolean;
}

export interface RoutePlanner extends RoutePlannerState {
  planTo: (place: Place) => void;
  select: (routeId: string) => void;
  openSheet: () => void;
  closeSheet: () => void;
  clear: () => void;
  /** Swaps in a freshly fetched route (a re-route) and persists it. */
  replaceRoute: (route: PlannedRoute) => void;
  /** MMKV-backed Valhalla response cache shared with navigation re-routes. */
  cache: ValhallaCache;
}

function restore(store: KeyValueStore): RoutePlannerState {
  const active = loadActiveRoute(store);
  const candidates = active ? loadRouteCandidates(store) : [];
  const routes = active ? (candidates.some((r) => r.id === active.id) ? candidates : [active, ...candidates]) : [];
  return {
    status: active ? 'ready' : 'idle',
    destination: active?.destination ?? null,
    origin: null,
    routes,
    active,
    mock: active?.mock ?? false,
    failedProfiles: [],
    error: null,
    sheetOpen: false,
  };
}

/**
 * Owns the plan-a-trip flow: locate, fetch alternatives, persist, choose.
 * A route is written to MMKV the moment it arrives, and again on every selection, so
 * a restart or a dead zone never loses the route the driver picked.
 */
export function useRoutePlanner(store: KeyValueStore, valhallaBaseUrl: string): RoutePlanner {
  // Restoring reads MMKV synchronously, so a cold launch shows the saved route immediately.
  const [state, setState] = useState<RoutePlannerState>(() => restore(store));
  const abortRef = useRef<AbortController | null>(null);
  const cache = useMemo(() => new ValhallaCache(store), [store]);
  const routesRef = useRef<PlannedRoute[]>(state.routes);
  routesRef.current = state.routes;

  useEffect(() => () => abortRef.current?.abort(), []);

  const planTo = useCallback(
    (place: Place) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState((prev) => ({
        ...prev,
        status: 'locating',
        destination: place,
        routes: [],
        failedProfiles: [],
        error: null,
        sheetOpen: true,
      }));

      (async () => {
        const origin = await getOrigin();
        if (controller.signal.aborted) return;
        setState((prev) => ({ ...prev, status: 'planning', origin }));

        try {
          const result = await planRoutes({
            origin,
            destination: place,
            baseUrl: valhallaBaseUrl,
            signal: controller.signal,
            cache,
          });
          if (controller.signal.aborted) return;
          const first = result.routes[0];
          saveRouteCandidates(store, result.routes);
          saveActiveRoute(store, first);
          setState((prev) => ({
            ...prev,
            status: 'ready',
            routes: result.routes,
            active: first,
            mock: result.mock,
            failedProfiles: result.failedProfiles,
            error: null,
          }));
        } catch (e) {
          if (controller.signal.aborted) return;
          setState((prev) => ({
            ...prev,
            status: 'error',
            error: e instanceof Error ? e.message : 'Could not plan a route.',
          }));
        }
      })();
    },
    [store, valhallaBaseUrl, cache],
  );

  const select = useCallback(
    (routeId: string) => {
      const route = routesRef.current.find((r) => r.id === routeId);
      if (!route) return;
      saveActiveRoute(store, route); // persist outside the state updater: updaters must stay pure
      setState((prev) => ({ ...prev, active: route }));
    },
    [store],
  );

  const openSheet = useCallback(() => setState((prev) => (prev.routes.length > 0 ? { ...prev, sheetOpen: true } : prev)), []);
  const closeSheet = useCallback(() => setState((prev) => ({ ...prev, sheetOpen: false })), []);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    clearActiveRoute(store);
    clearRouteCandidates(store);
    setState({
      status: 'idle',
      destination: null,
      origin: null,
      routes: [],
      active: null,
      mock: false,
      failedProfiles: [],
      error: null,
      sheetOpen: false,
    });
  }, [store]);

  const replaceRoute = useCallback(
    (route: PlannedRoute) => {
      saveRouteCandidates(store, [route]);
      saveActiveRoute(store, route);
      setState((prev) => ({
        ...prev,
        status: 'ready',
        destination: route.destination,
        routes: [route],
        active: route,
        mock: route.mock,
        failedProfiles: [],
        error: null,
      }));
    },
    [store],
  );

  return { ...state, planTo, select, openSheet, closeSheet, clear, replaceRoute, cache };
}
