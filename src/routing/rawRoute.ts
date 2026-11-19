import { z } from 'zod';

import { estimateTolls, bundledTollData, type LngLat, type TollData } from '../utils/tollCalculator';
import {
  plannedRouteSchema,
  routeStepSchema,
  routeWarningSchema,
  type Place,
  type PlannedRoute,
  type RouteProfile,
  type RouteStep,
  type RouteWarning,
} from './routeTypes';

/** Validates a RawRoute read back from the response cache. */
export const rawRouteSchema = z.object({
  shape: z.array(z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])).min(2),
  steps: z.array(routeStepSchema),
  distanceM: z.number().nonnegative(),
  durationSec: z.number().nonnegative(),
  hasToll: z.boolean(),
  hasFerry: z.boolean(),
  extraWarnings: z.array(routeWarningSchema),
});

/** A route in our own units, whether it came from Valhalla or from the mock generator. */
export interface RawRoute {
  shape: LngLat[];
  steps: RouteStep[];
  distanceM: number;
  durationSec: number;
  /** Valhalla's own `has_toll` flag, used to flag routes whose tolls we cannot price. */
  hasToll: boolean;
  hasFerry: boolean;
  /** Warnings from sources other than the response itself (mock data, later alert feeds). */
  extraWarnings: RouteWarning[];
}

export interface FinalizeContext {
  profile: RouteProfile;
  origin: { lng: number; lat: number };
  destination: Place;
  /** Stops the driver added before the destination. */
  waypoints?: readonly Place[];
  mock: boolean;
  now: number;
  tollData?: TollData;
}

/** Valhalla maneuver types for "you have arrived": 4 (arrive), 5 (right), 6 (left). */
const ARRIVE_TYPES = new Set([4, 5, 6]);

/**
 * Joins consecutive legs (origin->stop, stop->destination) into one route. Each leg's
 * closing "arrive" maneuver becomes "Stop at <name>" so the HUD never claims the whole
 * trip is over at an intermediate stop. Shape indices of later legs are shifted into
 * the joined shape.
 */
export function joinRawRoutes(legs: readonly RawRoute[], stopNames: readonly string[]): RawRoute {
  const shape: LngLat[] = [];
  const steps: RouteStep[] = [];
  legs.forEach((leg, legIndex) => {
    const base = legIndex === 0 ? 0 : shape.length - 1;
    shape.push(...(legIndex === 0 ? leg.shape : leg.shape.slice(1)));
    const isLastLeg = legIndex === legs.length - 1;
    leg.steps.forEach((step) => {
      const closesStop = !isLastLeg && ARRIVE_TYPES.has(step.type);
      steps.push({
        ...step,
        instruction: closesStop ? `Stop at ${stopNames[legIndex] ?? 'your stop'}` : step.instruction,
        beginShapeIndex: base + step.beginShapeIndex,
        endShapeIndex: base + step.endShapeIndex,
      });
    });
  });
  return {
    shape,
    steps,
    distanceM: legs.reduce((sum, leg) => sum + leg.distanceM, 0),
    durationSec: legs.reduce((sum, leg) => sum + leg.durationSec, 0),
    hasToll: legs.some((leg) => leg.hasToll),
    hasFerry: legs.some((leg) => leg.hasFerry),
    // Both legs of a mock route can carry the same sample warning; show it once.
    extraWarnings: [...new Map(legs.flatMap((leg) => leg.extraWarnings).map((w) => [w.message, w])).values()],
  };
}

/**
 * Adds the offline toll estimate and derived warnings, then validates the result
 * against `plannedRouteSchema`. Throws if the route is not storable.
 */
export function finalizeRoute(raw: RawRoute, ctx: FinalizeContext): PlannedRoute {
  const estimate = estimateTolls(raw.shape, ctx.tollData ?? bundledTollData);
  const warnings: RouteWarning[] = [...raw.extraWarnings];

  if (raw.hasFerry) warnings.push({ kind: 'ferry', message: 'This route includes a ferry crossing.' });
  if (raw.hasToll && estimate.charges.length === 0) {
    warnings.push({
      kind: 'toll_incomplete',
      message: 'This route has tolls we have no rates for, so the toll total may be too low.',
    });
  }

  return plannedRouteSchema.parse({
    id: `${ctx.profile}-${ctx.now}`,
    profile: ctx.profile,
    alsoProfiles: [],
    distanceM: raw.distanceM,
    durationSec: raw.durationSec,
    shape: raw.shape,
    steps: raw.steps,
    toll: {
      totalRinggit: estimate.totalRinggit,
      isEstimate: true,
      placeholderData: estimate.placeholderData,
      dataVersion: estimate.dataVersion,
      charges: estimate.charges.map((c) => ({
        highwayShortName: c.highwayShortName,
        label: c.label,
        rateRinggit: c.rateRinggit,
        alongM: c.alongM,
      })),
    },
    warnings,
    origin: ctx.origin,
    destination: ctx.destination,
    waypoints: ctx.waypoints ?? [],
    mock: ctx.mock,
    createdAt: ctx.now,
  });
}

/**
 * Valhalla often returns the same road for different costing profiles. Showing three
 * identical cards is noise, so near-identical routes are merged into the first one
 * (input order is priority order) and remembered in `alsoProfiles`.
 */
export function dedupeRoutes(routes: readonly PlannedRoute[]): PlannedRoute[] {
  const kept: PlannedRoute[] = [];
  const keys = new Map<string, PlannedRoute>();
  for (const route of routes) {
    const key = `${Math.round(route.distanceM / 100)}|${Math.round(route.durationSec / 30)}|${route.toll.totalRinggit}`;
    const existing = keys.get(key);
    if (existing) {
      existing.alsoProfiles = [...existing.alsoProfiles, route.profile];
      continue;
    }
    const copy = { ...route, alsoProfiles: [...route.alsoProfiles] };
    keys.set(key, copy);
    kept.push(copy);
  }
  return kept;
}
