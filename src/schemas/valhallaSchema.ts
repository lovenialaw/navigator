/**
 * Zod schema for Valhalla's `/route` response (`trip.legs[].maneuvers[]`).
 *
 * Validated against a real response from valhalla1.openstreetmap.de (see
 * `__tests__/fixtures/valhalla-klcc-seremban.json`). What that taught us:
 *  - `sign.exit_number_elements` carries expressway exit numbers ("1201B", "218").
 *  - `sign.exit_branch_elements` carries the road a ramp leads to; `exit_toward_elements`
 *    carries destinations.
 *  - `lanes` was ABSENT from every maneuver on a Klang Valley to Seremban trip. Malaysian
 *    OSM data rarely has turn:lanes, so lane guidance must stay optional everywhere.
 *
 * The exact `lanes` wire format differs between Valhalla builds, so it is parsed
 * leniently: `directions` may be an array of strings or a numeric bitmask, and `active`
 * may be a boolean or a bitmask. Anything unrecognised is dropped, never thrown on.
 */
import { z } from 'zod';

import { LANE_DIRECTIONS, type Lane, type LaneDirection } from '../routing/routeTypes';
import { sanitizeText } from '../utils/safeText';

// ---------------------------------------------------------------------------
// Lanes
// ---------------------------------------------------------------------------

/** Valhalla's lane direction bitmask (valhalla/baldr/turnlanes.h). Merges map to slight turns. */
const LANE_BITS: readonly (readonly [bit: number, direction: LaneDirection])[] = [
  [2, 'through'],
  [4, 'sharp_left'],
  [8, 'left'],
  [16, 'slight_left'],
  [32, 'slight_right'],
  [64, 'right'],
  [128, 'sharp_right'],
  [256, 'reverse'],
  [512, 'slight_left'],
  [1024, 'slight_right'],
];

const LANE_ALIASES: Record<string, LaneDirection> = {
  left: 'left',
  right: 'right',
  through: 'through',
  straight: 'through',
  slight_left: 'slight_left',
  slight_right: 'slight_right',
  sharp_left: 'sharp_left',
  sharp_right: 'sharp_right',
  reverse: 'reverse',
  uturn: 'reverse',
  merge_to_left: 'slight_left',
  merge_to_right: 'slight_right',
};

function toLaneDirections(value: unknown): LaneDirection[] {
  const found: LaneDirection[] = [];
  const add = (direction: LaneDirection) => {
    if (!found.includes(direction)) found.push(direction);
  };

  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    for (const [bit, direction] of LANE_BITS) if (value & bit) add(direction);
  } else if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item !== 'string') continue;
      const key = item.trim().toLowerCase().replace(/[\s-]+/g, '_');
      const direction = LANE_ALIASES[key];
      if (direction) add(direction);
    }
  }
  return found;
}

function toActive(lane: Record<string, unknown>): boolean {
  const flag = lane.active ?? lane.valid;
  if (typeof flag === 'boolean') return flag;
  if (typeof flag === 'number') return flag > 0;
  return false;
}

/** Normalises a raw `lanes` value to our lane model. Never throws; bad input gives []. */
export function normalizeLanes(input: unknown): Lane[] {
  if (!Array.isArray(input)) return [];
  const lanes: Lane[] = [];
  for (const item of input.slice(0, 12)) {
    if (typeof item !== 'object' || item === null) continue;
    const raw = item as Record<string, unknown>;
    const directions = toLaneDirections(raw.directions);
    // Sanity: keep only recognised direction names even if the schema grows.
    if (directions.length === 0) continue;
    lanes.push({ directions: directions.filter((d) => LANE_DIRECTIONS.includes(d)), active: toActive(raw) });
  }
  return lanes;
}

// ---------------------------------------------------------------------------
// Signs
// ---------------------------------------------------------------------------

const signElements = z.array(z.looseObject({ text: z.unknown().optional() })).optional().catch(undefined);

const signSchema = z
  .object({
    exit_number_elements: signElements,
    exit_branch_elements: signElements,
    exit_toward_elements: signElements,
    exit_name_elements: signElements,
  })
  .optional()
  .catch(undefined);

/** "Jalan A, Jalan B" from sign elements: sanitised, de-duplicated, empty when none. */
export function joinSignElements(elements: readonly { text?: unknown }[] | undefined, maxLength = 160): string | undefined {
  if (!elements) return undefined;
  const texts: string[] = [];
  for (const element of elements) {
    const text = sanitizeText(element.text, 80);
    if (text && !texts.includes(text)) texts.push(text);
  }
  return texts.join(', ').slice(0, maxLength) || undefined;
}

// ---------------------------------------------------------------------------
// Maneuvers and response
// ---------------------------------------------------------------------------

export const maneuverSchema = z.object({
  /** Maneuver icon code (1 start, 4 destination, 10 right, 15 left, 20/21 exit, ...). */
  type: z.number().int().nonnegative().catch(0),
  instruction: z.unknown().optional(),
  street_names: z.array(z.unknown()).optional().catch(undefined),
  /** kilometres */
  length: z.number().nonnegative().catch(0),
  /** seconds */
  time: z.number().nonnegative().catch(0),
  begin_shape_index: z.number().int().nonnegative().catch(0),
  end_shape_index: z.number().int().nonnegative().catch(0),
  /** Optional, usually absent in Malaysia. See file header. */
  lanes: z.unknown().optional(),
  sign: signSchema,
  toll: z.boolean().optional().catch(undefined),
});
export type ValhallaManeuver = z.infer<typeof maneuverSchema>;

const legSchema = z.object({
  shape: z.string().min(2),
  maneuvers: z.array(maneuverSchema).default([]),
});

export const valhallaResponseSchema = z.object({
  trip: z.object({
    legs: z.array(legSchema).min(1),
    summary: z.object({
      /** kilometres */
      length: z.number().nonnegative(),
      /** seconds */
      time: z.number().nonnegative(),
      has_toll: z.boolean().catch(false),
      has_ferry: z.boolean().catch(false),
    }),
  }),
});
export type ValhallaResponse = z.infer<typeof valhallaResponseSchema>;
