/**
 * Offline toll estimator for the route planner.
 *
 * Input is a route polyline (the same [lng, lat] points we cache in MMKV), output
 * is a Class 1 toll total in RM. Nothing here touches the network: the rates ship
 * in `src/data/malaysiaTolls.json` and are validated with zod when the module loads.
 *
 * How a route is priced:
 *  - OPEN highways (LDP, KESAS, MEX, DUKE, AKLEH): every plaza the route passes
 *    within `openRadiusM` is charged its flat rate, once. A plaza with a
 *    `chargeDirection` (KESAS Awan Besar East/West) is only charged when the route
 *    travels that way, so one trip pays one plaza, not both.
 *  - CLOSED highways (PLUS): the first and last interchange the route passes are
 *    treated as entry and exit, and the pair is looked up in the rate table.
 *
 * Limits to keep in mind: detection is geometric, so a parallel road within the
 * radius of a plaza can be a false positive, and the shipped rates are placeholders
 * (`placeholderData` is true). The UI must always label the result an estimate.
 */
import { z } from 'zod';

import rawTolls from '../data/malaysiaTolls.json';
import { DEG, EARTH_RADIUS_M, angleDiffDeg, haversineM, type LngLat } from './geo';

export type { LngLat } from './geo';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/** Display strings are stripped of anything tag-like before they can reach the UI. */
const safeText = z
  .string()
  .transform((value) => value.replace(/<[^>]*>/g, '').trim())
  .pipe(z.string().min(1).max(120));

const paymentMethod = z.enum(['TNG', 'RFID', 'OPEN_PAYMENT']);
const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);
const rate = z.number().min(0).max(1000);

const plazaBase = {
  plazaCode: z.string().regex(/^[A-Z0-9-]+$/),
  name: safeText,
  kmMarker: z.number().min(0),
  lat,
  lng,
  paymentMethods: z.array(paymentMethod),
};

const highwayBase = {
  highwayCode: z.string().min(1),
  shortName: safeText,
  fullName: safeText,
  operator: safeText,
};

/**
 * Some plazas only charge one direction of travel (e.g. KESAS Awan Besar East vs West).
 * `bearingDeg` is the compass bearing of the charged direction, 0 = north, clockwise.
 */
const chargeDirectionSchema = z.object({
  bearingDeg: z.number().min(0).max(360),
  toleranceDeg: z.number().min(1).max(180),
});
export type ChargeDirection = z.infer<typeof chargeDirectionSchema>;

const openHighwaySchema = z.object({
  ...highwayBase,
  systemType: z.literal('OPEN'),
  plazas: z
    .array(z.object({ ...plazaBase, rateClass1: rate, chargeDirection: chargeDirectionSchema.optional() }))
    .min(1),
});

const closedHighwaySchema = z.object({
  ...highwayBase,
  systemType: z.literal('CLOSED'),
  plazas: z.array(z.object(plazaBase)).min(2),
  rates: z.array(
    z.object({
      from: z.string(),
      to: z.string(),
      rateClass1: rate,
    }),
  ),
});

export const tollDataSchema = z
  .object({
    version: z.string().min(1),
    currency: z.literal('MYR'),
    vehicleClass: z.literal(1),
    placeholder: z.boolean().default(false),
    disclaimer: z.string().optional(),
    description: z.string().optional(),
    highways: z.array(z.discriminatedUnion('systemType', [openHighwaySchema, closedHighwaySchema])),
  })
  .superRefine((data, ctx) => {
    const seen = new Set<string>();
    for (const highway of data.highways) {
      for (const plaza of highway.plazas) {
        if (seen.has(plaza.plazaCode)) {
          ctx.addIssue({ code: 'custom', message: `duplicate plazaCode ${plaza.plazaCode}` });
        }
        seen.add(plaza.plazaCode);
      }
    }
    for (const highway of data.highways) {
      if (highway.systemType !== 'CLOSED') continue;
      const codes = new Set(highway.plazas.map((p) => p.plazaCode));
      const pairs = new Set<string>();
      for (const entry of highway.rates) {
        if (!codes.has(entry.from) || !codes.has(entry.to) || entry.from === entry.to) {
          ctx.addIssue({
            code: 'custom',
            message: `${highway.shortName} rate ${entry.from} -> ${entry.to} references an unknown or identical plaza`,
          });
          continue;
        }
        const key = pairKey(entry.from, entry.to);
        if (pairs.has(key)) {
          ctx.addIssue({ code: 'custom', message: `${highway.shortName} has a duplicate rate for ${key}` });
        }
        pairs.add(key);
      }
    }
  });

export type TollData = z.infer<typeof tollDataSchema>;

/** Throws a ZodError with readable paths. Use for data you control (tests, build-time). */
export function parseTollData(input: unknown): TollData {
  return tollDataSchema.parse(input);
}

const EMPTY_TOLL_DATA: TollData = {
  version: 'empty',
  currency: 'MYR',
  vehicleClass: 1,
  placeholder: true,
  highways: [],
};

/**
 * The bundled dataset. If the JSON were ever malformed this degrades to "no tolls
 * known" rather than crashing navigation; the unit tests fail first in that case.
 */
export const bundledTollData: TollData = (() => {
  const parsed = tollDataSchema.safeParse(rawTolls);
  return parsed.success ? parsed.data : EMPTY_TOLL_DATA;
})();

// ---------------------------------------------------------------------------
// Estimation
// ---------------------------------------------------------------------------

export interface TollCharge {
  highwayCode: string;
  highwayShortName: string;
  kind: 'open' | 'closed';
  /** Plaza for open systems, "Entry -> Exit" for closed systems. */
  label: string;
  /** Plaza codes involved: one for open, [entry, exit] for closed. */
  plazaCodes: string[];
  rateRinggit: number;
  /** Distance along the route (metres) where this toll is paid; the exit for closed systems. */
  alongM: number;
}

export interface TollEstimate {
  /** Always true: show "Est." next to the amount. */
  isEstimate: true;
  /** True while the dataset still contains development placeholder rates. */
  placeholderData: boolean;
  currency: 'MYR';
  vehicleClass: 1;
  dataVersion: string;
  totalRinggit: number;
  charges: TollCharge[];
  warnings: string[];
}

export interface TollOptions {
  /** How close the route must pass to an open-system plaza to be charged. */
  openRadiusM?: number;
  /** How close the route must pass to a closed-system interchange to count it. */
  closedRadiusM?: number;
}

export const DEFAULT_OPEN_RADIUS_M = 150;
export const DEFAULT_CLOSED_RADIUS_M = 300;

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function cumulativeLengths(route: readonly LngLat[]): number[] {
  const out = [0];
  for (let i = 1; i < route.length; i += 1) out.push(out[i - 1] + haversineM(route[i - 1], route[i]));
  return out;
}

interface Crossing {
  distanceM: number;
  alongM: number;
  /** Travel bearing of the route segment at the closest point, or null for a zero-length segment. */
  bearingDeg: number | null;
}

export { angleDiffDeg };

/**
 * Closest approach of the polyline to a point, or null when it never gets within
 * `radiusM`. With `direction`, only segments travelling that way are considered, so a
 * route heading the other way past the plaza is not a crossing.
 */
function closestApproach(
  route: readonly LngLat[],
  cumulative: readonly number[],
  point: LngLat,
  radiusM: number,
  direction?: ChargeDirection,
): Crossing | null {
  const kx = DEG * EARTH_RADIUS_M * Math.cos(point[1] * DEG);
  const ky = DEG * EARTH_RADIUS_M;
  const padLng = radiusM / kx;
  const padLat = radiusM / ky;
  let best: Crossing | null = null;

  for (let i = 0; i < route.length - 1; i += 1) {
    const a = route[i];
    const b = route[i + 1];
    // Cheap bounding-box reject before doing any projection math.
    if (
      Math.max(a[0], b[0]) < point[0] - padLng ||
      Math.min(a[0], b[0]) > point[0] + padLng ||
      Math.max(a[1], b[1]) < point[1] - padLat ||
      Math.min(a[1], b[1]) > point[1] + padLat
    ) {
      continue;
    }

    // Local flat projection with the plaza at the origin.
    const ax = (a[0] - point[0]) * kx;
    const ay = (a[1] - point[1]) * ky;
    const dx = (b[0] - point[0]) * kx - ax;
    const dy = (b[1] - point[1]) * ky - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2));
    const distanceM = Math.hypot(ax + t * dx, ay + t * dy);
    if (distanceM > radiusM || (best !== null && distanceM >= best.distanceM)) continue;

    // Compass bearing of this segment (x = east, y = north in the local projection).
    const bearingDeg = len2 === 0 ? null : (Math.atan2(dx, dy) / DEG + 360) % 360;
    // Unknown bearing (zero-length segment) is accepted: better to over-charge than miss a toll.
    if (direction && bearingDeg !== null && angleDiffDeg(bearingDeg, direction.bearingDeg) > direction.toleranceDeg) continue;

    best = { distanceM, alongM: cumulative[i] + t * (cumulative[i + 1] - cumulative[i]), bearingDeg };
  }
  return best;
}

function toSen(ringgit: number): number {
  return Math.round(ringgit * 100);
}

function isValidPoint(p: LngLat): boolean {
  return Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;
}

/** Prices a route polyline. Never throws; bad input yields a zero total plus a warning. */
export function estimateTolls(
  route: readonly LngLat[],
  data: TollData = bundledTollData,
  options: TollOptions = {},
): TollEstimate {
  const openRadiusM = options.openRadiusM ?? DEFAULT_OPEN_RADIUS_M;
  const closedRadiusM = options.closedRadiusM ?? DEFAULT_CLOSED_RADIUS_M;
  const warnings: string[] = [];
  const charges: TollCharge[] = [];

  const base = {
    isEstimate: true as const,
    placeholderData: data.placeholder,
    currency: 'MYR' as const,
    vehicleClass: 1 as const,
    dataVersion: data.version,
  };

  const usable = route.filter(isValidPoint);
  if (usable.length < 2) {
    warnings.push('Route has too few valid points to estimate tolls.');
    return { ...base, totalRinggit: 0, charges, warnings };
  }
  if (usable.length !== route.length) warnings.push('Some invalid route points were ignored.');

  const cumulative = cumulativeLengths(usable);
  let totalSen = 0;

  for (const highway of data.highways) {
    if (highway.systemType === 'OPEN') {
      const hits = highway.plazas
        .map((plaza) => ({
          plaza,
          crossing: closestApproach(usable, cumulative, [plaza.lng, plaza.lat], openRadiusM, plaza.chargeDirection),
        }))
        .filter((hit) => hit.crossing !== null)
        .sort((x, y) => (x.crossing?.alongM ?? 0) - (y.crossing?.alongM ?? 0));

      for (const { plaza, crossing } of hits) {
        charges.push({
          highwayCode: highway.highwayCode,
          highwayShortName: highway.shortName,
          kind: 'open',
          label: plaza.name,
          plazaCodes: [plaza.plazaCode],
          rateRinggit: plaza.rateClass1,
          alongM: Math.round(crossing?.alongM ?? 0),
        });
        totalSen += toSen(plaza.rateClass1);
      }
      continue;
    }

    // CLOSED system: entry is the first interchange passed, exit is the last.
    const passed = highway.plazas
      .map((plaza) => ({
        plaza,
        crossing: closestApproach(usable, cumulative, [plaza.lng, plaza.lat], closedRadiusM),
      }))
      .filter((hit): hit is { plaza: (typeof highway.plazas)[number]; crossing: Crossing } => hit.crossing !== null)
      .sort((x, y) => x.crossing.alongM - y.crossing.alongM);

    if (passed.length === 0) continue;
    if (passed.length === 1) {
      warnings.push(`Route touches ${highway.shortName} at ${passed[0].plaza.name} only, so no ${highway.shortName} toll was added.`);
      continue;
    }

    const entry = passed[0].plaza;
    const exit = passed[passed.length - 1].plaza;
    const match = highway.rates.find((r) => pairKey(r.from, r.to) === pairKey(entry.plazaCode, exit.plazaCode));
    if (!match) {
      warnings.push(`No ${highway.shortName} rate for ${entry.name} to ${exit.name}.`);
      continue;
    }

    charges.push({
      highwayCode: highway.highwayCode,
      highwayShortName: highway.shortName,
      kind: 'closed',
      label: `${entry.name} -> ${exit.name}`,
      plazaCodes: [entry.plazaCode, exit.plazaCode],
      rateRinggit: match.rateClass1,
      alongM: Math.round(passed[passed.length - 1].crossing.alongM),
    });
    totalSen += toSen(match.rateClass1);
  }

  return { ...base, totalRinggit: totalSen / 100, charges, warnings };
}

/** "RM 4.20". Non-finite or negative values render as "RM 0.00". */
export function formatRinggit(amount: number): string {
  const safe = Number.isFinite(amount) && amount > 0 ? amount : 0;
  return `RM ${safe.toFixed(2)}`;
}
