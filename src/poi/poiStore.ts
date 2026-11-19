import { z } from 'zod';

import type { KeyValueStore } from '../storage/keyValueStore';
import { poiSchema, type Poi } from './poiTypes';

export const POI_CACHE_KEY = 'tuju.poi.route.v1';

const lng = z.number().min(-180).max(180);
const lat = z.number().min(-90).max(90);

const entrySchema = z.object({
  routeId: z.string().min(1),
  savedAt: z.number().int().nonnegative(),
  /** Coarse polyline the POIs were fetched along. Lets a re-route reuse them offline. */
  corridor: z.array(z.tuple([lng, lat])).min(2).max(400),
  pois: z.array(poiSchema).max(1000),
});
export type PoiCacheEntry = z.infer<typeof entrySchema>;

/** Only the latest route's POIs are kept: one entry, so MMKV never grows. */
export function savePoiCache(store: KeyValueStore, entry: PoiCacheEntry): void {
  store.set(POI_CACHE_KEY, JSON.stringify(entry));
}

export function loadPoiCache(store: KeyValueStore): PoiCacheEntry | null {
  const raw = store.getString(POI_CACHE_KEY);
  if (!raw) return null;
  try {
    const parsed = entrySchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
  } catch {
    // fall through
  }
  store.remove(POI_CACHE_KEY);
  return null;
}

export function clearPoiCache(store: KeyValueStore): void {
  store.remove(POI_CACHE_KEY);
}

export type { Poi };
