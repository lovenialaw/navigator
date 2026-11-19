/**
 * Client-side map matching for turn-by-turn guidance.
 *
 * The problem: on stacked KL/Penang highways (AKLEH, DUKE) a raw GPS fix is often closer
 * to the ground road under the flyover than to the elevated road we are actually on,
 * so a generic "snap to nearest road" makes the puck jump levels. We never consult the
 * road network at all. We snap only onto OUR ACTIVE ROUTE polyline, and only forward:
 *
 *  1. Perpendicular projection onto route segments in a window covering the current
 *     maneuver (its begin_shape_index..end_shape_index) plus the next one.
 *  2. Bearing gate: when the device has a trustworthy heading, a segment is a candidate
 *     only if its bearing is within +-35 degrees of the travel bearing. A parallel road
 *     going the other way, or a crossing road, is rejected.
 *  3. Monotonic: the segment index and distance along the route never go backwards.
 *  4. Off-route: only when the nearest route point is more than 60 m away AND that has
 *     lasted more than 5 s do we report `reroute`. Shorter blips just show the raw fix.
 *
 * Everything here is pure: callers hold the `MatchState` and pass it back in.
 */
import { angleDiffDeg, bearingDeg, haversineM, projectOnSegment, type LngLat } from './geo';

export interface MatchConfig {
  /** Max difference between device heading and segment bearing to allow a snap. */
  maxBearingDiffDeg: number;
  /** Distance from the route beyond which the driver counts as off-route. */
  offRouteDistanceM: number;
  /** How long they must stay off-route before a re-route is requested. */
  offRouteTimeMs: number;
  /** Below this speed the compass/course heading is noise, so the bearing gate is skipped. */
  minSpeedForHeadingMps: number;
  /** How many maneuvers beyond the current one are searched each fix. */
  lookaheadSteps: number;
}

export const MATCH_CONFIG: MatchConfig = {
  maxBearingDiffDeg: 35,
  offRouteDistanceM: 60,
  offRouteTimeMs: 5000,
  minSpeedForHeadingMps: 2.5,
  lookaheadSteps: 1,
};

/** The part of a maneuver the matcher needs. */
export interface StepRange {
  beginShapeIndex: number;
  endShapeIndex: number;
}

export interface RouteGeometry {
  shape: readonly LngLat[];
  /** Metres from the start to each shape point. Same length as `shape`. */
  cumulativeM: readonly number[];
  totalM: number;
  /** Travel bearing of each segment i (shape[i] -> shape[i+1]). NaN for zero-length segments. */
  segmentBearing: readonly number[];
  steps: readonly StepRange[];
}

export function buildRouteGeometry(shape: readonly LngLat[], steps: readonly StepRange[]): RouteGeometry {
  const cumulativeM: number[] = [0];
  const segmentBearing: number[] = [];
  for (let i = 1; i < shape.length; i += 1) {
    const length = haversineM(shape[i - 1], shape[i]);
    cumulativeM.push(cumulativeM[i - 1] + length);
    segmentBearing.push(length < 0.5 ? Number.NaN : bearingDeg(shape[i - 1], shape[i]));
  }
  return { shape, cumulativeM, totalM: cumulativeM[cumulativeM.length - 1] ?? 0, segmentBearing, steps };
}

function segmentCount(geometry: RouteGeometry): number {
  return Math.max(0, geometry.shape.length - 1);
}

/** Index of the maneuver being driven when the vehicle is on segment `segmentIndex`. */
export function stepIndexAtSegment(geometry: RouteGeometry, segmentIndex: number): number {
  let found = 0;
  for (let j = 0; j < geometry.steps.length; j += 1) {
    if (geometry.steps[j].beginShapeIndex <= segmentIndex) found = j;
    else break;
  }
  return found;
}

/** Point `alongM` metres along the route, searching forward from `fromSegment`. */
export function locateAlong(
  geometry: RouteGeometry,
  alongM: number,
  fromSegment = 0,
): { segmentIndex: number; point: LngLat; alongM: number } {
  const last = segmentCount(geometry) - 1;
  const clamped = Math.min(Math.max(alongM, 0), geometry.totalM);
  let i = Math.min(Math.max(fromSegment, 0), Math.max(last, 0));
  while (i < last && geometry.cumulativeM[i + 1] < clamped) i += 1;
  const a = geometry.shape[i];
  const b = geometry.shape[i + 1] ?? a;
  const length = geometry.cumulativeM[i + 1] - geometry.cumulativeM[i];
  const t = length > 0 ? Math.min(1, Math.max(0, (clamped - geometry.cumulativeM[i]) / length)) : 0;
  return { segmentIndex: i, point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], alongM: clamped };
}

// ---------------------------------------------------------------------------
// State and matching
// ---------------------------------------------------------------------------

export interface GpsFix {
  lng: number;
  lat: number;
  /** Travel bearing in degrees, or null when the device has none (iOS reports -1). */
  headingDeg: number | null;
  /** Metres per second, or null when unknown. */
  speedMps: number | null;
  timestampMs: number;
}

export interface MatchState {
  /** Route segment the vehicle is on. Never decreases. */
  segmentIndex: number;
  /** Metres travelled along the route. Never decreases. */
  alongM: number;
  /** Last point we showed on the route. */
  lastSnapped: LngLat;
  /** When the current off-route stretch began, or null while on route. */
  offRouteSinceMs: number | null;
}

export type MatchStatus =
  /** Snapped onto the route. */
  | 'on-route'
  /** Within range of the route but travelling a different way (e.g. the carriageway below). Not snapped. */
  | 'unaligned'
  /** More than 60 m from the route, less than 5 s so far. */
  | 'off-route'
  /** More than 60 m from the route for more than 5 s: ask for a new route. */
  | 'reroute';

export interface MatchResult {
  state: MatchState;
  /** Where to draw the puck: on the route when matched, the raw fix otherwise. */
  position: LngLat;
  status: MatchStatus;
  /** Distance from the fix to the nearest route point, metres. */
  deviationM: number;
  /** Bearing of the matched segment (for map rotation), or null when not matched. */
  bearingDeg: number | null;
}

export function initialMatchState(geometry: RouteGeometry, alongM = 0): MatchState {
  const located = locateAlong(geometry, alongM);
  return { segmentIndex: located.segmentIndex, alongM: located.alongM, lastSnapped: located.point, offRouteSinceMs: null };
}

interface Candidate {
  segmentIndex: number;
  t: number;
  distanceM: number;
}

/** Nearest segment in [from, to], optionally restricted to those travelling along `heading`. */
function scan(
  geometry: RouteGeometry,
  point: LngLat,
  from: number,
  to: number,
  heading: number | null,
  maxBearingDiffDeg: number,
): Candidate | null {
  let best: Candidate | null = null;
  for (let i = from; i <= to; i += 1) {
    if (heading !== null) {
      const segBearing = geometry.segmentBearing[i];
      // A zero-length segment has no direction: it cannot be confirmed, so it is not a candidate.
      if (Number.isNaN(segBearing) || angleDiffDeg(segBearing, heading) > maxBearingDiffDeg) continue;
    }
    const projection = projectOnSegment(point, geometry.shape[i], geometry.shape[i + 1]);
    if (best === null || projection.distanceM < best.distanceM) {
      best = { segmentIndex: i, t: projection.t, distanceM: projection.distanceM };
    }
  }
  return best;
}

function trustedHeading(fix: GpsFix, config: MatchConfig): number | null {
  const { headingDeg, speedMps } = fix;
  if (headingDeg === null || !Number.isFinite(headingDeg) || headingDeg < 0) return null;
  if (speedMps !== null && Number.isFinite(speedMps) && speedMps < config.minSpeedForHeadingMps) return null;
  return headingDeg % 360;
}

/**
 * Matches one GPS fix to the route. Returns the new state, where to draw the puck and
 * whether guidance should keep going, show a warning, or re-route.
 */
export function matchFix(
  geometry: RouteGeometry,
  state: MatchState,
  fix: GpsFix,
  config: MatchConfig = MATCH_CONFIG,
): MatchResult {
  const raw: LngLat = [fix.lng, fix.lat];
  const lastSegment = segmentCount(geometry) - 1;
  if (lastSegment < 0) {
    return { state, position: raw, status: 'off-route', deviationM: Infinity, bearingDeg: null };
  }

  const heading = trustedHeading(fix, config);
  const from = Math.min(state.segmentIndex, lastSegment);

  // 1. Window: the maneuver being driven plus `lookaheadSteps` more. Never behind `from`.
  const currentStep = stepIndexAtSegment(geometry, from);
  const windowStep = Math.min(currentStep + config.lookaheadSteps, geometry.steps.length - 1);
  const windowEnd = geometry.steps.length
    ? Math.min(lastSegment, Math.max(geometry.steps[windowStep].endShapeIndex - 1, from))
    : lastSegment;

  let aligned = scan(geometry, raw, from, windowEnd, heading, config.maxBearingDiffDeg);
  if (aligned === null || aligned.distanceM > config.offRouteDistanceM) {
    // 2. Re-acquire anywhere ahead on the route (tunnel exit, GPS gap). Still forward-only.
    aligned = scan(geometry, raw, from, lastSegment, heading, config.maxBearingDiffDeg);
  }

  if (aligned !== null && aligned.distanceM <= config.offRouteDistanceM) {
    const segmentIndex = Math.max(from, aligned.segmentIndex);
    const alongRaw =
      geometry.cumulativeM[aligned.segmentIndex] +
      aligned.t * (geometry.cumulativeM[aligned.segmentIndex + 1] - geometry.cumulativeM[aligned.segmentIndex]);
    // 3. Monotonic: GPS jitter can project slightly backwards, which must not move the puck back.
    const alongM = Math.max(state.alongM, alongRaw);
    const located = locateAlong(geometry, alongM, segmentIndex);
    return {
      state: { segmentIndex: located.segmentIndex, alongM: located.alongM, lastSnapped: located.point, offRouteSinceMs: null },
      position: located.point,
      status: 'on-route',
      deviationM: aligned.distanceM,
      bearingDeg: Number.isNaN(geometry.segmentBearing[located.segmentIndex]) ? null : geometry.segmentBearing[located.segmentIndex],
    };
  }

  // Not matched. How far is the route, ignoring direction?
  const nearest = scan(geometry, raw, from, lastSegment, null, config.maxBearingDiffDeg);
  const deviationM = nearest?.distanceM ?? Infinity;

  if (deviationM <= config.offRouteDistanceM) {
    // Close to the route but heading the wrong way for it: do not snap, do not start the clock.
    return {
      state: { ...state, offRouteSinceMs: null },
      position: raw,
      status: 'unaligned',
      deviationM,
      bearingDeg: null,
    };
  }

  // 4. Genuinely off route: time it.
  const since = state.offRouteSinceMs ?? fix.timestampMs;
  const status: MatchStatus = fix.timestampMs - since > config.offRouteTimeMs ? 'reroute' : 'off-route';
  return { state: { ...state, offRouteSinceMs: since }, position: raw, status, deviationM, bearingDeg: null };
}

/**
 * Dead reckoning for GPS gaps (tunnels): advance along the route by `distanceM`.
 * Guidance keeps moving on the cached maneuvers instead of freezing.
 */
export function advanceAlong(geometry: RouteGeometry, state: MatchState, distanceM: number): MatchState {
  if (!(distanceM > 0)) return state;
  const located = locateAlong(geometry, state.alongM + distanceM, state.segmentIndex);
  return { segmentIndex: located.segmentIndex, alongM: located.alongM, lastSnapped: located.point, offRouteSinceMs: null };
}
