import { z } from 'zod';

import { safeText } from '../utils/safeText';

export const ROUTE_PROFILES = ['fastest', 'avoid_tolls', 'trunk_roads'] as const;
export type RouteProfile = (typeof ROUTE_PROFILES)[number];
export const routeProfileSchema = z.enum(ROUTE_PROFILES);

export const ROUTE_PROFILE_LABEL: Record<RouteProfile, string> = {
  fastest: 'Fastest',
  avoid_tolls: 'No tolls',
  trunk_roads: 'Trunk roads',
};

const lng = z.number().min(-180).max(180);
const lat = z.number().min(-90).max(90);
const point = z.tuple([lng, lat]);

/** Most extra stops on one trip. Keeps the Valhalla request, and the trip, sane. */
export const MAX_WAYPOINTS = 3;

export const placeSchema = z.object({
  id: z.string().min(1).max(80),
  name: safeText(120).pipe(z.string().min(1)),
  subtitle: safeText(160),
  lng,
  lat,
});
export type Place = z.infer<typeof placeSchema>;

export const LANE_DIRECTIONS = [
  'left',
  'through',
  'right',
  'slight_left',
  'slight_right',
  'sharp_left',
  'sharp_right',
  'reverse',
] as const;
export type LaneDirection = (typeof LANE_DIRECTIONS)[number];

export const laneSchema = z.object({
  /** Every direction this lane may take (a lane can be "through + right"). */
  directions: z.array(z.enum(LANE_DIRECTIONS)).max(6),
  /** True when this lane leads to the upcoming maneuver, so the driver should be in it. */
  active: z.boolean(),
});
export type Lane = z.infer<typeof laneSchema>;

export const routeStepSchema = z.object({
  instruction: safeText(200),
  distanceM: z.number().nonnegative(),
  durationSec: z.number().nonnegative(),
  /** Valhalla maneuver type id. Kept raw: the HUD maps it to an icon. */
  type: z.number().int().nonnegative(),
  streetNames: z.array(safeText(80)).max(8),
  location: point,
  /** Indices into the route shape where this maneuver begins and ends. */
  beginShapeIndex: z.number().int().nonnegative(),
  endShapeIndex: z.number().int().nonnegative(),
  /** Empty when the data source has no lane information, which is common on Malaysian roads. */
  lanes: z.array(laneSchema).max(12).default([]),
  /** Expressway exit number such as "1201B" or "218". */
  exitNumber: safeText(24).optional(),
  /** Where the exit or ramp leads, such as "Jalan Sultan Ismail". */
  exitBranch: safeText(160).optional(),
  exitToward: safeText(160).optional(),
  /** Valhalla flagged this stretch as tolled. */
  toll: z.boolean().default(false),
});
export type RouteStep = z.infer<typeof routeStepSchema>;

export const routeWarningSchema = z.object({
  kind: z.enum(['unpaved', 'flood_prone', 'ferry', 'toll_incomplete']),
  message: safeText(160).pipe(z.string().min(1)),
});
export type RouteWarning = z.infer<typeof routeWarningSchema>;

export const tollSummarySchema = z.object({
  totalRinggit: z.number().nonnegative(),
  isEstimate: z.literal(true),
  placeholderData: z.boolean(),
  dataVersion: z.string(),
  charges: z.array(
    z.object({
      highwayShortName: safeText(40),
      label: safeText(120),
      rateRinggit: z.number().nonnegative(),
      /** Metres from the route start where this toll is paid. */
      alongM: z.number().nonnegative(),
    }),
  ),
});
export type TollSummary = z.infer<typeof tollSummarySchema>;

/** One drivable option. This exact shape is what we persist in MMKV for offline guidance. */
export const plannedRouteSchema = z.object({
  id: z.string().min(1),
  profile: routeProfileSchema,
  /** Other profiles that returned an identical route and were merged into this one. */
  alsoProfiles: z.array(routeProfileSchema).default([]),
  distanceM: z.number().nonnegative(),
  durationSec: z.number().nonnegative(),
  shape: z.array(point).min(2),
  steps: z.array(routeStepSchema),
  toll: tollSummarySchema,
  warnings: z.array(routeWarningSchema),
  origin: z.object({ lng, lat }),
  destination: placeSchema,
  /**
   * Stops the driver added on the way (R&R, petrol, EV). The final destination is never
   * replaced by one of these. Routes saved before this existed load with none.
   */
  waypoints: z.array(placeSchema).max(MAX_WAYPOINTS).default([]),
  /** True when generated from built-in sample data (no backend configured). */
  mock: z.boolean().default(false),
  createdAt: z.number().int().nonnegative(),
});
export type PlannedRoute = z.infer<typeof plannedRouteSchema>;
