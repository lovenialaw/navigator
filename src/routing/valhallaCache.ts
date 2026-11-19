import { z } from 'zod';

import type { KeyValueStore } from '../storage/keyValueStore';
import { rawRouteSchema, type RawRoute } from './rawRoute';
import type { RouteProfile } from './routeTypes';

export const CACHE_INDEX_KEY = 'tuju.valhalla.cache.index.v1';
export const CACHE_ENTRY_PREFIX = 'tuju.valhalla.cache.v1:';
/** Roads rarely change within a day; this keeps a driver from re-querying on every tap. */
export const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
export const CACHE_MAX_ENTRIES = 24;

const indexSchema = z.array(z.object({ key: z.string(), savedAt: z.number() }));
const entrySchema = z.object({ savedAt: z.number(), raw: rawRouteSchema });

interface Point {
  lng: number;
  lat: number;
}

/**
 * Origin is rounded to ~110 m and destination to ~11 m, so GPS jitter and a re-tapped
 * result hit the cache instead of the public server.
 */
export function cacheKeyFor(
  profile: RouteProfile,
  origin: Point,
  destination: Point,
  waypoints: readonly Point[] = [],
): string {
  const base = `${profile}|${origin.lat.toFixed(3)},${origin.lng.toFixed(3)}|${destination.lat.toFixed(4)},${destination.lng.toFixed(4)}`;
  // A trip with stops is a different route from the same trip without them.
  return waypoints.length === 0
    ? base
    : `${base}|via:${waypoints.map((w) => `${w.lat.toFixed(4)},${w.lng.toFixed(4)}`).join(';')}`;
}

export interface CacheOptions {
  now?: () => number;
  ttlMs?: number;
  maxEntries?: number;
}

/**
 * MMKV-backed cache of normalised Valhalla routes. Every successful live response is
 * stored (respecting the public server's fair-use limits) and a stale copy can still
 * serve a re-route when there is no signal.
 */
export class ValhallaCache {
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(
    private readonly store: KeyValueStore,
    options: CacheOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? CACHE_TTL_MS;
    this.maxEntries = options.maxEntries ?? CACHE_MAX_ENTRIES;
  }

  get(key: string, opts: { allowStale?: boolean } = {}): RawRoute | null {
    const raw = this.store.getString(CACHE_ENTRY_PREFIX + key);
    if (!raw) return null;
    try {
      const entry = entrySchema.parse(JSON.parse(raw));
      if (!opts.allowStale && this.now() - entry.savedAt > this.ttlMs) return null;
      return entry.raw;
    } catch {
      this.drop(key);
      return null;
    }
  }

  set(key: string, route: RawRoute): void {
    const savedAt = this.now();
    this.store.set(CACHE_ENTRY_PREFIX + key, JSON.stringify({ savedAt, raw: route }));

    const index = this.readIndex().filter((item) => item.key !== key);
    index.push({ key, savedAt });
    while (index.length > this.maxEntries) {
      const oldest = index.shift();
      if (oldest) this.store.remove(CACHE_ENTRY_PREFIX + oldest.key);
    }
    this.store.set(CACHE_INDEX_KEY, JSON.stringify(index));
  }

  private drop(key: string): void {
    this.store.remove(CACHE_ENTRY_PREFIX + key);
    this.store.set(CACHE_INDEX_KEY, JSON.stringify(this.readIndex().filter((item) => item.key !== key)));
  }

  private readIndex(): { key: string; savedAt: number }[] {
    const raw = this.store.getString(CACHE_INDEX_KEY);
    if (!raw) return [];
    try {
      return indexSchema.parse(JSON.parse(raw));
    } catch {
      return [];
    }
  }
}
