import { z } from 'zod';

import { haversineM, type LngLat } from '../utils/geo';
import { sanitizeText } from '../utils/safeText';
import { detectBrand, poiSchema, type Poi, type PoiKind } from './poiTypes';

/** How far from the route line a POI may sit and still be listed. */
export const CORRIDOR_RADIUS_M = 1500;
/** Points are spaced a bit under 2 x radius so circles overlap and leave no gaps. */
const CORRIDOR_SPACING_M = 2400;
/** Caps the request body. 350 points x 2.4 km covers ~840 km, longer than Peninsular Malaysia. */
const MAX_CORRIDOR_POINTS = 350;
const MAX_POIS = 800;
const DEFAULT_TIMEOUT_MS = 30_000;

/** Evenly spaced points along the route, always including the last. */
export function corridorPoints(
  shape: readonly LngLat[],
  spacingM = CORRIDOR_SPACING_M,
  maxPoints = MAX_CORRIDOR_POINTS,
): LngLat[] {
  if (shape.length === 0) return [];
  const points: LngLat[] = [shape[0]];
  let sinceLast = 0;
  for (let i = 1; i < shape.length; i += 1) {
    sinceLast += haversineM(shape[i - 1], shape[i]);
    if (sinceLast >= spacingM) {
      points.push(shape[i]);
      sinceLast = 0;
      if (points.length >= maxPoints) return points;
    }
  }
  const last = shape[shape.length - 1];
  if (points[points.length - 1] !== last && points.length < maxPoints) points.push(last);
  return points;
}

/** Overpass QL for fuel, rest areas and EV chargers within `radiusM` of the route. */
export function buildOverpassQuery(shape: readonly LngLat[], radiusM = CORRIDOR_RADIUS_M): string {
  const around = corridorPoints(shape)
    .map(([lng, lat]) => `${lat.toFixed(5)},${lng.toFixed(5)}`)
    .join(',');
  const filter = `(around:${radiusM},${around})`;
  return [
    '[out:json][timeout:25];',
    '(',
    `  nwr["amenity"="fuel"]${filter};`,
    `  nwr["highway"~"^(services|rest_area)$"]${filter};`,
    `  nwr["amenity"="charging_station"]${filter};`,
    ');',
    'out center tags;',
  ].join('\n');
}

const elementSchema = z.object({
  type: z.enum(['node', 'way', 'relation']),
  id: z.number(),
  lat: z.number().optional(),
  lon: z.number().optional(),
  center: z.object({ lat: z.number(), lon: z.number() }).optional(),
  tags: z.record(z.string(), z.unknown()).optional(),
});

const responseSchema = z.object({ elements: z.array(z.unknown()) });

function classify(tags: Record<string, string>): PoiKind | null {
  if (tags.access === 'private') return null;
  if (tags.amenity === 'fuel') return 'fuel';
  if (tags.amenity === 'charging_station') return 'ev';
  if (tags.highway === 'services' || tags.highway === 'rest_area') return 'rnr';
  return null;
}

const FALLBACK_NAME: Record<PoiKind, string> = { rnr: 'Rest & Service Area', fuel: 'Petrol station', ev: 'EV charger' };

/**
 * Turns an Overpass response into validated POIs. Overpass is a public, user-edited
 * database, so every element is checked on its own and a bad one is dropped, never
 * allowed to fail the whole list.
 */
export function parseOverpass(json: unknown): Poi[] {
  const top = responseSchema.safeParse(json);
  if (!top.success) return [];

  const seen = new Set<string>();
  const pois: Poi[] = [];
  for (const raw of top.data.elements) {
    if (pois.length >= MAX_POIS) break;
    const element = elementSchema.safeParse(raw);
    if (!element.success) continue;
    const { type, id, tags: rawTags = {} } = element.data;
    const lat = element.data.lat ?? element.data.center?.lat;
    const lon = element.data.lon ?? element.data.center?.lon;
    if (lat === undefined || lon === undefined) continue;

    const tags: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawTags)) if (typeof value === 'string') tags[key] = value;
    const kind = classify(tags);
    if (!kind) continue;

    const key = `osm:${type}:${id}`;
    if (seen.has(key)) continue;

    const name = sanitizeText(tags.name ?? tags['name:en'] ?? tags.brand ?? tags.operator, 100) || FALLBACK_NAME[kind];
    const poi = poiSchema.safeParse({
      id: key,
      kind,
      name,
      brand: kind === 'fuel' ? detectBrand(tags) : undefined,
      operator: kind === 'ev' ? (tags.operator ?? tags.network ?? tags.brand) : undefined,
      lng: lon,
      lat,
    });
    if (!poi.success) continue;
    seen.add(key);
    pois.push(poi.data);
  }
  return pois;
}

export class PoiFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PoiFetchError';
  }
}

export interface FetchPoisParams {
  overpassUrl: string;
  shape: readonly LngLat[];
  fetch?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** One request per route; the caller caches the result in MMKV. */
export async function fetchRoutePois(params: FetchPoisParams): Promise<Poi[]> {
  const doFetch = params.fetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  params.signal?.addEventListener('abort', onAbort);
  try {
    const response = await doFetch(params.overpassUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: `data=${encodeURIComponent(buildOverpassQuery(params.shape))}`,
      signal: controller.signal,
    });
    if (!response.ok) throw new PoiFetchError(`POI server returned ${response.status}`);
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new PoiFetchError('POI server sent an unreadable response');
    }
    return parseOverpass(json);
  } catch (error) {
    if (error instanceof PoiFetchError) throw error;
    throw new PoiFetchError('Could not reach the POI server');
  } finally {
    clearTimeout(timer);
    params.signal?.removeEventListener('abort', onAbort);
  }
}
