import { z } from 'zod';

import { PHOTON_BIAS, isPlaceholderUrl } from '../config/tujuConfig';
import { placeSchema, type Place } from '../routing/routeTypes';
import { sanitizeText } from '../utils/safeText';
import { searchMockPlaces } from './mockPlaces';

/** West, south, east, north: keeps Photon from returning Singapore or Indonesia for "Pekan". */
export const MALAYSIA_BBOX = '99.6,0.8,119.3,7.4';
export const DEFAULT_RESULT_LIMIT = 8;
export const MIN_QUERY_LENGTH = 2;

const optionalString = z.string().optional().catch(undefined);

const featureSchema = z.object({
  geometry: z.object({
    coordinates: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
  }),
  properties: z
    .object({
      name: optionalString,
      street: optionalString,
      housenumber: optionalString,
      locality: optionalString,
      district: optionalString,
      city: optionalString,
      county: optionalString,
      state: optionalString,
      countrycode: optionalString,
      osm_type: optionalString,
      osm_id: z.number().optional().catch(undefined),
      osm_key: optionalString,
      osm_value: optionalString,
    })
    .default({}),
});
type PhotonFeature = z.infer<typeof featureSchema>;

const responseSchema = z.object({ features: z.array(z.unknown()) });

export class PlaceSearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlaceSearchError';
  }
}

export interface SearchPlacesParams {
  query: string;
  baseUrl: string;
  /** Overrides the default Malaysia bias point (`PHOTON_BIAS`). */
  focus?: { lng: number; lat: number };
  limit?: number;
  fetch?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface SearchPlacesResult {
  places: Place[];
  mock: boolean;
}

/**
 * Photon ranks by text relevance and distance, not by what a driver wants. This nudges
 * the Malaysian cases to the top while keeping Photon's order within each tier:
 * mall parking entrances, malls, and kampung / mukim style place names.
 */
export function relevanceBoost(feature: PhotonFeature): number {
  const { name = '', osm_value: value = '' } = feature.properties;
  let score = 0;
  if (value === 'parking_entrance' || /parking|entrance|masuk/i.test(name)) score += 2;
  if (value === 'mall' || value === 'department_store') score += 2;
  if (/^(kampung|kg\.?|mukim|felda|taman)\b/i.test(name) || value === 'village' || value === 'hamlet') score += 2;
  return score;
}

function describe(feature: PhotonFeature, name: string): string {
  const p = feature.properties;
  const street = [p.housenumber, p.street].filter(Boolean).join(' ');
  const seen = new Set<string>([name.toLowerCase()]);
  const parts: string[] = [];
  for (const part of [street, p.locality, p.district, p.city, p.county, p.state]) {
    const clean = sanitizeText(part, 60);
    if (clean && !seen.has(clean.toLowerCase())) {
      seen.add(clean.toLowerCase());
      parts.push(clean);
    }
  }
  return parts.join(', ').slice(0, 160);
}

/** Converts Photon features to places, silently dropping any that are unusable. */
export function parsePhotonResponse(json: unknown, limit = DEFAULT_RESULT_LIMIT): Place[] {
  const envelope = responseSchema.safeParse(json);
  if (!envelope.success) throw new PlaceSearchError('Search server sent an unexpected response');

  const usable: { place: Place; score: number }[] = [];
  const seenIds = new Set<string>();

  envelope.data.features.forEach((raw, index) => {
    const parsed = featureSchema.safeParse(raw);
    if (!parsed.success) return;
    const feature = parsed.data;
    const code = feature.properties.countrycode?.toUpperCase();
    if (code && code !== 'MY') return;

    const p = feature.properties;
    const name = sanitizeText(p.name || [p.housenumber, p.street].filter(Boolean).join(' ') || p.city || p.district, 120);
    if (!name) return;

    const [lng, lat] = feature.geometry.coordinates;
    const id =
      p.osm_type && p.osm_id !== undefined ? `${p.osm_type}${p.osm_id}` : `pt-${index}-${lng.toFixed(5)}-${lat.toFixed(5)}`;
    if (seenIds.has(id)) return;

    const place = placeSchema.safeParse({ id, name, subtitle: describe(feature, name), lng, lat });
    if (!place.success) return;
    seenIds.add(id);
    usable.push({ place: place.data, score: relevanceBoost(feature) });
  });

  // Array.prototype.sort is stable: equal scores keep Photon's own ranking.
  return usable
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((u) => u.place);
}

export async function searchPlaces(params: SearchPlacesParams): Promise<SearchPlacesResult> {
  const query = params.query.trim();
  const limit = params.limit ?? DEFAULT_RESULT_LIMIT;
  if (query.length < MIN_QUERY_LENGTH) return { places: [], mock: isPlaceholderUrl(params.baseUrl) };

  if (isPlaceholderUrl(params.baseUrl)) return { places: searchMockPlaces(query, limit), mock: true };

  // Always bias toward Malaysia (`&lat=3.0733&lon=101.6067` unless a focus is given).
  const focus = params.focus ?? PHOTON_BIAS;
  const search = new URLSearchParams({
    q: query,
    limit: String(limit),
    lang: 'en',
    bbox: MALAYSIA_BBOX,
    lat: String(focus.lat),
    lon: String(focus.lng),
    location_bias_scale: '0.4',
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? 8000);
  const onAbort = () => controller.abort();
  params.signal?.addEventListener('abort', onAbort);
  try {
    const response = await (params.fetch ?? fetch)(`${params.baseUrl.replace(/\/+$/, '')}/api?${search.toString()}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new PlaceSearchError(`Search server returned ${response.status}`);
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new PlaceSearchError('Search server sent an unreadable response');
    }
    return { places: parsePhotonResponse(json, limit), mock: false };
  } catch (error) {
    if (error instanceof PlaceSearchError) throw error;
    if (params.signal?.aborted) throw error;
    throw new PlaceSearchError('Could not reach the search server');
  } finally {
    clearTimeout(timer);
    params.signal?.removeEventListener('abort', onAbort);
  }
}
