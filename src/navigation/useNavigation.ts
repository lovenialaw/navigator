import { LocationManager, type GeolocationPosition } from '@maplibre/maplibre-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Place, PlannedRoute } from '../routing/routeTypes';
import { planRoutes } from '../routing/valhallaClient';
import type { ValhallaCache } from '../routing/valhallaCache';
import type { KeyValueStore } from '../storage/keyValueStore';
import {
  advanceAlong,
  buildRouteGeometry,
  initialMatchState,
  matchFix,
  type GpsFix,
  type MatchState,
  type MatchStatus,
} from '../utils/mapMatcher';
import { buildHudModel, computeProgress, type HudModel } from './guidance';
import { clearNavSession, loadNavSession, saveNavSession } from './session';
import { remainingStops, withStop } from './stops';

/** No fix for this long and we start dead-reckoning along the cached route. */
export const GPS_STALE_MS = 3000;
/** Stop dead-reckoning after this long without GPS (a long tunnel); better to freeze than guess. */
export const MAX_DEAD_RECKON_MS = 120_000;
/** Minimum gap between re-route attempts, so a bad signal cannot hammer a public server. */
export const REROUTE_MIN_INTERVAL_MS = 20_000;
const SESSION_SAVE_INTERVAL_MS = 3000;

export interface NavPosition {
  lng: number;
  lat: number;
  /** Heading of the road the puck is snapped to, for rotating the map. Null when unmatched. */
  bearingDeg: number | null;
}

export interface NavigationView {
  hud: HudModel | null;
  position: NavPosition | null;
  matchStatus: MatchStatus | null;
  gpsLost: boolean;
  /** "Re-routing…" or an offline notice. */
  notice: string | null;
  /** Metres driven along the active route. Drives the "Along Your Route" distances. */
  alongM: number;
}

export interface Navigation extends NavigationView {
  navigating: boolean;
  start: () => void;
  stop: () => void;
  /** One tap: route via this stop and still finish at the original destination. */
  addStop: (place: Place) => void;
  removeStop: (placeId: string) => void;
}

interface Params {
  store: KeyValueStore;
  route: PlannedRoute | null;
  valhallaBaseUrl: string;
  cache: ValhallaCache;
  /** Called with a fresh route after a successful re-route. */
  onRouteReplaced: (route: PlannedRoute) => void;
}

const EMPTY_VIEW: NavigationView = {
  hud: null,
  position: null,
  matchStatus: null,
  gpsLost: false,
  notice: null,
  alongM: 0,
};

/**
 * Active turn-by-turn guidance. Everything it needs is already on the phone: the route
 * and its maneuvers come from MMKV, the position from GPS (which needs no mobile data).
 * Network is used only to re-route, and a failed re-route just keeps following the
 * cached route.
 */
export function useNavigation({ store, route, valhallaBaseUrl, cache, onRouteReplaced }: Params): Navigation {
  // A drive in progress when the app was killed resumes straight away on a cold launch.
  const [navigating, setNavigating] = useState(() => {
    const session = loadNavSession(store);
    return session !== null && route !== null && session.routeId === route.id;
  });
  const [view, setView] = useState<NavigationView>(EMPTY_VIEW);

  const geometry = useMemo(() => (route ? buildRouteGeometry(route.shape, route.steps) : null), [route]);

  const matchRef = useRef<MatchState | null>(null);
  const lastFixRef = useRef<{ at: number; speedMps: number | null } | null>(null);
  const deadReckonAtRef = useRef<number | null>(null);
  const lastSavedAtRef = useRef(0);
  const lastRerouteAtRef = useRef(0);
  const reroutingRef = useRef(false);
  const latest = useRef({ route, valhallaBaseUrl, cache, onRouteReplaced });
  latest.current = { route, valhallaBaseUrl, cache, onRouteReplaced };

  const publish = useCallback(
    (state: MatchState, position: NavPosition, status: MatchStatus, gpsLost: boolean, notice?: string | null) => {
      if (!route || !geometry) return;
      const progress = computeProgress(route, geometry, state);
      setView((prev) => ({
        hud: buildHudModel(route, progress, Date.now()),
        position,
        matchStatus: status,
        gpsLost,
        notice: notice === undefined ? prev.notice : notice,
        alongM: state.alongM,
      }));
    },
    [route, geometry],
  );

  const persistProgress = useCallback(
    (state: MatchState, force = false) => {
      const current = latest.current.route;
      const now = Date.now();
      if (!current || (!force && now - lastSavedAtRef.current < SESSION_SAVE_INTERVAL_MS)) return;
      lastSavedAtRef.current = now;
      const existing = loadNavSession(store);
      saveNavSession(store, {
        routeId: current.id,
        startedAt: existing?.routeId === current.id ? existing.startedAt : now,
        alongM: state.alongM,
      });
    },
    [store],
  );

  // (Re)initialise matching whenever navigation starts or the route changes.
  useEffect(() => {
    if (!navigating || !route || !geometry) {
      matchRef.current = null;
      lastFixRef.current = null;
      deadReckonAtRef.current = null;
      setView(EMPTY_VIEW);
      return;
    }
    const session = loadNavSession(store);
    const resumeAlong = session && session.routeId === route.id ? session.alongM : 0;
    const state = initialMatchState(geometry, resumeAlong);
    matchRef.current = state;
    lastFixRef.current = null;
    deadReckonAtRef.current = null;
    publish(state, { lng: state.lastSnapped[0], lat: state.lastSnapped[1], bearingDeg: null }, 'on-route', false, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigating, route?.id]);

  /**
   * Asks Valhalla for a new route from `origin` to the ORIGINAL destination through
   * `waypoints`. On failure (dead zone, server trouble) the saved route keeps guiding.
   */
  const requestRoute = useCallback(
    (origin: { lng: number; lat: number }, waypoints: Place[], pending: string, failed: string) => {
      const { route: current, valhallaBaseUrl: baseUrl, cache: responseCache, onRouteReplaced: replace } = latest.current;
      if (!current || reroutingRef.current) return;
      reroutingRef.current = true;
      setView((prev) => ({ ...prev, notice: pending }));

      planRoutes({
        origin,
        destination: current.destination,
        waypoints,
        baseUrl,
        profiles: [current.profile],
        cache: responseCache,
      })
        .then((result) => {
          const next = result.routes[0];
          saveNavSession(store, { routeId: next.id, startedAt: Date.now(), alongM: 0 });
          replace(next);
          setView((prev) => ({ ...prev, notice: null }));
        })
        .catch(() => setView((prev) => ({ ...prev, notice: failed })))
        .finally(() => {
          reroutingRef.current = false;
        });
    },
    [store],
  );

  const reroute = useCallback(
    (fix: GpsFix) => {
      const { route: current } = latest.current;
      const state = matchRef.current;
      if (!current || !geometry || !state || reroutingRef.current) return;
      const now = Date.now();
      if (now - lastRerouteAtRef.current < REROUTE_MIN_INTERVAL_MS) return;
      lastRerouteAtRef.current = now;
      requestRoute(
        { lng: fix.lng, lat: fix.lat },
        // A re-route keeps the stops the driver has not reached yet.
        remainingStops(geometry, current.waypoints, state.alongM),
        'Off route. Re-routing…',
        'Cannot re-route right now. Following your saved route.',
      );
    },
    [geometry, requestRoute],
  );

  const addStop = useCallback(
    (place: Place) => {
      const { route: current } = latest.current;
      const state = matchRef.current;
      if (!current || !geometry || !state) return;
      if (reroutingRef.current) {
        setView((prev) => ({ ...prev, notice: 'Still updating your route. Try again in a moment.' }));
        return;
      }
      const change = withStop(geometry, current.waypoints, state.alongM, place);
      if (!change.ok) {
        setView((prev) => ({ ...prev, notice: change.reason }));
        return;
      }
      // Route from where the car is now; the final destination never changes.
      requestRoute(
        { lng: state.lastSnapped[0], lat: state.lastSnapped[1] },
        change.stops,
        `Adding stop: ${place.name}…`,
        'Cannot add the stop right now. Following your saved route.',
      );
    },
    [geometry, requestRoute],
  );

  const removeStop = useCallback(
    (placeId: string) => {
      const { route: current } = latest.current;
      const state = matchRef.current;
      if (!current || !geometry || !state || reroutingRef.current) return;
      const ahead = remainingStops(geometry, current.waypoints, state.alongM);
      if (!ahead.some((s) => s.id === placeId)) return;
      requestRoute(
        { lng: state.lastSnapped[0], lat: state.lastSnapped[1] },
        ahead.filter((s) => s.id !== placeId),
        'Removing stop…',
        'Cannot remove the stop right now. Following your saved route.',
      );
    },
    [geometry, requestRoute],
  );

  // GPS fixes -> map matching -> HUD.
  useEffect(() => {
    if (!navigating || !route || !geometry) return undefined;
    let cancelled = false;
    let subscribed = false;

    const onPosition = (location: GeolocationPosition) => {
      const state = matchRef.current;
      if (cancelled || !state) return;
      const { coords } = location;
      if (!Number.isFinite(coords.longitude) || !Number.isFinite(coords.latitude)) return;

      const now = Date.now();
      const speedMps = coords.speed !== null && coords.speed >= 0 ? coords.speed : null;
      const fix: GpsFix = {
        lng: coords.longitude,
        lat: coords.latitude,
        headingDeg: coords.heading !== null && coords.heading >= 0 ? coords.heading : null,
        speedMps,
        timestampMs: now,
      };
      lastFixRef.current = { at: now, speedMps };
      deadReckonAtRef.current = null;

      const result = matchFix(geometry, state, fix);
      matchRef.current = result.state;
      publish(
        result.state,
        { lng: result.position[0], lat: result.position[1], bearingDeg: result.bearingDeg },
        result.status,
        false,
      );
      persistProgress(result.state);
      if (result.status === 'reroute') reroute(fix);
    };

    LocationManager.requestPermissions()
      .catch(() => false)
      .then(() => {
        if (cancelled) return;
        LocationManager.addListener(onPosition);
        LocationManager.start();
        subscribed = true;
      });

    // No GPS (tunnel, urban canyon): keep the guidance moving from the cached maneuvers.
    const timer = setInterval(() => {
      const state = matchRef.current;
      const lastFix = lastFixRef.current;
      if (cancelled || !state || !lastFix) return;
      const now = Date.now();
      const gap = now - lastFix.at;
      if (gap < GPS_STALE_MS) return;

      const since = deadReckonAtRef.current ?? lastFix.at + GPS_STALE_MS;
      deadReckonAtRef.current = now;
      const canGuess = gap < MAX_DEAD_RECKON_MS && lastFix.speedMps !== null && lastFix.speedMps > 1;
      const advanced = canGuess ? advanceAlong(geometry, state, (lastFix.speedMps as number) * ((now - since) / 1000)) : state;
      matchRef.current = advanced;
      publish(
        advanced,
        { lng: advanced.lastSnapped[0], lat: advanced.lastSnapped[1], bearingDeg: null },
        'on-route',
        true,
      );
      persistProgress(advanced);
    }, 1000);

    return () => {
      cancelled = true;
      clearInterval(timer);
      if (subscribed) {
        LocationManager.removeListener(onPosition);
        LocationManager.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigating, route?.id, geometry]);

  // Notices ("Cannot add the stop…") are transient. A pending one clears when the request ends.
  useEffect(() => {
    if (!view.notice || reroutingRef.current) return undefined;
    const timer = setTimeout(() => setView((prev) => ({ ...prev, notice: null })), 6000);
    return () => clearTimeout(timer);
  }, [view.notice]);

  const start = useCallback(() => {
    if (!route) return;
    saveNavSession(store, { routeId: route.id, startedAt: Date.now(), alongM: 0 });
    reroutingRef.current = false;
    lastRerouteAtRef.current = 0;
    setNavigating(true);
  }, [route, store]);

  const stop = useCallback(() => {
    clearNavSession(store);
    setNavigating(false);
  }, [store]);

  return { ...view, navigating, start, stop, addStop, removeStop };
}
