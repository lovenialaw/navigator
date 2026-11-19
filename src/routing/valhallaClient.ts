import { isPlaceholderUrl } from '../config/tujuConfig';
import {
  joinSignElements,
  normalizeLanes,
  valhallaResponseSchema,
  type ValhallaResponse,
} from '../schemas/valhallaSchema';
import { sanitizeText } from '../utils/safeText';
import type { LngLat, TollData } from '../utils/tollCalculator';
import { buildMockRawRoutes } from './mockRoutes';
import { decodePolyline } from './polyline';
import { dedupeRoutes, finalizeRoute, joinRawRoutes, type RawRoute } from './rawRoute';
import { ROUTE_PROFILES, type Place, type PlannedRoute, type RouteProfile, type RouteStep } from './routeTypes';
import { cacheKeyFor, type ValhallaCache } from './valhallaCache';

export { valhallaResponseSchema, type ValhallaResponse } from '../schemas/valhallaSchema';

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

/**
 * Valhalla `auto` costing knobs per profile. All values are 0..1 preferences.
 *  - fastest:     no penalty for highways or tolls.
 *  - avoid_tolls: tolls heavily penalised.
 *  - trunk_roads: avoid motorways and tolls, prefer trunk/primary roads (rural trunk routes).
 */
const COSTING_OPTIONS: Record<RouteProfile, Record<string, number>> = {
  fastest: { use_highways: 1, use_tolls: 1 },
  avoid_tolls: { use_tolls: 0 },
  trunk_roads: { use_highways: 0, use_tolls: 0, use_trunk: 1 },
};

export interface Coordinate {
  lng: number;
  lat: number;
}

export function buildValhallaRequest(
  profile: RouteProfile,
  origin: Coordinate,
  destination: Coordinate,
  waypoints: readonly Coordinate[] = [],
) {
  // Stops are `break` locations: the driver really stops, and each one starts a new leg.
  const stops = [origin, ...waypoints, destination];
  return {
    id: profile,
    locations: stops.map((stop) => ({ lat: stop.lat, lon: stop.lng, type: 'break' })),
    costing: 'auto',
    costing_options: { auto: COSTING_OPTIONS[profile] },
    directions_options: { units: 'kilometers', language: 'en-US' },
  };
}

// ---------------------------------------------------------------------------
// Response -> our units
// ---------------------------------------------------------------------------

/** Valhalla maneuver types meaning "arrived": 4, 5 (right), 6 (left). */
const ARRIVE_MANEUVERS = new Set([4, 5, 6]);

/**
 * Turns a validated Valhalla response into our own units. Throws on a bad polyline.
 * `stopNames` names the break points between legs, so a leg's closing "arrive"
 * maneuver reads "Stop at <name>" instead of announcing the end of the whole trip.
 */
export function normalizeValhalla(response: ValhallaResponse, stopNames: readonly string[] = []): RawRoute {
  const shape: LngLat[] = [];
  const steps: RouteStep[] = [];

  response.trip.legs.forEach((leg, legIndex) => {
    const decoded = decodePolyline(leg.shape);
    // Legs share their joint point, so later legs drop their first point. Maneuver shape
    // indices are per leg, so they are offset into the joined shape.
    const base = legIndex === 0 ? 0 : shape.length - 1;
    shape.push(...(legIndex === 0 ? decoded : decoded.slice(1)));
    const lastLocal = decoded.length - 1;

    for (const m of leg.maneuvers) {
      const begin = Math.min(m.begin_shape_index, lastLocal);
      const end = Math.min(Math.max(m.end_shape_index, begin), lastLocal);
      const at = decoded[begin];
      if (!at) continue;

      const closesStop = legIndex < response.trip.legs.length - 1 && ARRIVE_MANEUVERS.has(m.type);
      const instruction = closesStop
        ? `Stop at ${sanitizeText(stopNames[legIndex] ?? 'your stop', 80)}`
        : sanitizeText(m.instruction, 200);
      steps.push({
        instruction: instruction || 'Continue',
        distanceM: Math.round(m.length * 1000),
        durationSec: Math.round(m.time),
        type: m.type,
        streetNames: (m.street_names ?? []).map((n) => sanitizeText(n, 80)).filter(Boolean).slice(0, 8),
        location: [at[0], at[1]],
        beginShapeIndex: base + begin,
        endShapeIndex: base + end,
        lanes: normalizeLanes(m.lanes),
        exitNumber: joinSignElements(m.sign?.exit_number_elements, 24),
        exitBranch: joinSignElements(m.sign?.exit_branch_elements),
        exitToward: joinSignElements(m.sign?.exit_toward_elements),
        toll: m.toll ?? false,
      });
    }
  });

  if (shape.length < 2) throw new Error('route has fewer than two points');

  return {
    shape,
    steps,
    distanceM: Math.round(response.trip.summary.length * 1000),
    durationSec: Math.round(response.trip.summary.time),
    hasToll: response.trip.summary.has_toll,
    hasFerry: response.trip.summary.has_ferry,
    extraWarnings: [],
  };
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

export interface PlanRoutesParams {
  origin: Coordinate;
  destination: Place;
  /** Stops to make on the way, in driving order. The destination stays the final stop. */
  waypoints?: readonly Place[];
  baseUrl: string;
  fetch?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
  now?: () => number;
  tollData?: TollData;
  /** Defaults to all three. A re-route only needs the profile being driven. */
  profiles?: readonly RouteProfile[];
  /**
   * MMKV-backed response cache. Hits skip the network entirely (public servers have
   * fair-use limits); a stale entry still serves when the network is unreachable.
   */
  cache?: ValhallaCache;
}

export interface PlanRoutesResult {
  /** Up to three routes, deduplicated, in profile priority order. */
  routes: PlannedRoute[];
  /** True when the endpoint is a `.invalid` placeholder and sample routes were generated. */
  mock: boolean;
  failedProfiles: RouteProfile[];
  /** Profiles answered from the local cache without a network request. */
  cachedProfiles: RouteProfile[];
}

export class RoutePlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoutePlanError';
  }
}

const DEFAULT_TIMEOUT_MS = 12_000;

async function fetchProfile(profile: RouteProfile, params: PlanRoutesParams, doFetch: typeof fetch): Promise<RawRoute> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  params.signal?.addEventListener('abort', onAbort);
  try {
    const response = await doFetch(`${params.baseUrl.replace(/\/+$/, '')}/route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(
        buildValhallaRequest(profile, params.origin, params.destination, params.waypoints ?? []),
      ),
      signal: controller.signal,
    });
    if (!response.ok) throw new RoutePlanError(`Routing server returned ${response.status}`);
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new RoutePlanError('Routing server sent an unreadable response');
    }
    const parsed = valhallaResponseSchema.safeParse(json);
    if (!parsed.success) throw new RoutePlanError('Routing server sent an unexpected response');
    return normalizeValhalla(
      parsed.data,
      (params.waypoints ?? []).map((w) => w.name),
    );
  } finally {
    clearTimeout(timer);
    params.signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Fetches the requested profiles in parallel (all three by default). Partial success is
 * fine (failed profiles are reported); total failure throws `RoutePlanError`.
 */
export async function planRoutes(params: PlanRoutesParams): Promise<PlanRoutesResult> {
  const now = (params.now ?? Date.now)();
  const mock = isPlaceholderUrl(params.baseUrl);
  const profiles = params.profiles ?? ROUTE_PROFILES;
  const waypoints = params.waypoints ?? [];
  const context = {
    origin: params.origin,
    destination: params.destination,
    waypoints,
    mock,
    now,
    tollData: params.tollData,
  };

  if (mock) {
    // One sample route per leg (origin -> stop -> ... -> destination), joined into one trip.
    const targets = [...waypoints, params.destination];
    const legs = targets.map((target, i) => buildMockRawRoutes(i === 0 ? params.origin : targets[i - 1], target));
    const stopNames = waypoints.map((w) => w.name);
    const routes = profiles.map((profile) =>
      finalizeRoute(joinRawRoutes(legs.map((leg) => leg[profile]), stopNames), { ...context, profile }),
    );
    return { routes: dedupeRoutes(routes), mock: true, failedProfiles: [], cachedProfiles: [] };
  }

  const doFetch = params.fetch ?? fetch;
  const cachedProfiles: RouteProfile[] = [];

  const loadRaw = async (profile: RouteProfile): Promise<RawRoute> => {
    const key = cacheKeyFor(profile, params.origin, params.destination, waypoints);
    const hit = params.cache?.get(key);
    if (hit) {
      cachedProfiles.push(profile);
      return hit;
    }
    try {
      const raw = await fetchProfile(profile, params, doFetch);
      params.cache?.set(key, raw);
      return raw;
    } catch (error) {
      // No signal: an out-of-date route beats no route.
      const stale = params.signal?.aborted ? null : params.cache?.get(key, { allowStale: true });
      if (stale) {
        cachedProfiles.push(profile);
        return stale;
      }
      throw error;
    }
  };

  const settled = await Promise.allSettled(
    profiles.map(async (profile) => finalizeRoute(await loadRaw(profile), { ...context, profile })),
  );

  const routes: PlannedRoute[] = [];
  const failedProfiles: RouteProfile[] = [];
  let firstError: unknown;
  settled.forEach((result, i) => {
    if (result.status === 'fulfilled') routes.push(result.value);
    else {
      failedProfiles.push(profiles[i]);
      firstError ??= result.reason;
    }
  });

  if (routes.length === 0) {
    if (params.signal?.aborted) throw new RoutePlanError('Route request cancelled');
    throw firstError instanceof RoutePlanError
      ? firstError
      : new RoutePlanError('Could not reach the routing server. Check your connection and try again.');
  }
  return { routes: dedupeRoutes(routes), mock: false, failedProfiles, cachedProfiles };
}
