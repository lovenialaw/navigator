import fixture from './fixtures/valhalla-klcc-seremban.json';
import { normalizeValhalla, planRoutes } from '../src/routing/valhallaClient';
import {
  CACHE_ENTRY_PREFIX,
  CACHE_INDEX_KEY,
  CACHE_MAX_ENTRIES,
  CACHE_TTL_MS,
  ValhallaCache,
  cacheKeyFor,
} from '../src/routing/valhallaCache';
import type { RawRoute } from '../src/routing/rawRoute';
import { valhallaResponseSchema } from '../src/schemas/valhallaSchema';
import { MemoryKeyValueStore } from '../src/storage/keyValueStore';

const LIVE = 'https://valhalla1.openstreetmap.de';
const origin = { lng: 101.7116, lat: 3.1579 };
const destination = { id: 'seremban', name: 'Seremban', subtitle: '', lng: 101.937, lat: 2.7266 };

const raw: RawRoute = normalizeValhalla(valhallaResponseSchema.parse(fixture));

function okFetch() {
  return jest.fn(async () => ({ ok: true, status: 200, json: async () => fixture }) as unknown as Response) as unknown as jest.MockedFunction<typeof fetch>;
}

describe('cacheKeyFor', () => {
  it('ignores GPS jitter under ~50 m but separates different trips and profiles', () => {
    const a = cacheKeyFor('fastest', origin, destination);
    expect(cacheKeyFor('fastest', { lng: origin.lng + 0.0001, lat: origin.lat - 0.0001 }, destination)).toBe(a);
    expect(cacheKeyFor('fastest', { lng: origin.lng + 0.01, lat: origin.lat }, destination)).not.toBe(a);
    expect(cacheKeyFor('avoid_tolls', origin, destination)).not.toBe(a);
    expect(cacheKeyFor('fastest', origin, { ...destination, lat: destination.lat + 0.001 })).not.toBe(a);
  });
});

describe('ValhallaCache', () => {
  it('round-trips a route through MMKV, lanes/exits/indices intact', () => {
    const store = new MemoryKeyValueStore();
    const cache = new ValhallaCache(store);
    expect(cache.get('k')).toBeNull();
    cache.set('k', raw);
    const back = cache.get('k');
    expect(back).toEqual(raw);
    expect(back?.steps.find((s) => s.exitNumber === '1201B')).toBeDefined();
  });

  it('expires after the TTL but can still serve a stale copy', () => {
    const store = new MemoryKeyValueStore();
    let now = 1_000_000;
    const cache = new ValhallaCache(store, { now: () => now });
    cache.set('k', raw);
    now += CACHE_TTL_MS - 1;
    expect(cache.get('k')).not.toBeNull();
    now += 2;
    expect(cache.get('k')).toBeNull();
    expect(cache.get('k', { allowStale: true })).not.toBeNull();
  });

  it('evicts the oldest entries beyond the limit', () => {
    const store = new MemoryKeyValueStore();
    let now = 0;
    const cache = new ValhallaCache(store, { now: () => (now += 1), maxEntries: 3 });
    ['a', 'b', 'c', 'd'].forEach((key) => cache.set(key, raw));
    expect(cache.get('a')).toBeNull();
    expect(store.getString(`${CACHE_ENTRY_PREFIX}a`)).toBeUndefined();
    expect(['b', 'c', 'd'].every((key) => cache.get(key) !== null)).toBe(true);
    expect(CACHE_MAX_ENTRIES).toBeGreaterThan(3);
  });

  it('re-setting a key refreshes it instead of duplicating it', () => {
    const store = new MemoryKeyValueStore();
    const cache = new ValhallaCache(store, { maxEntries: 2 });
    cache.set('a', raw);
    cache.set('b', raw);
    cache.set('a', raw);
    cache.set('c', raw); // evicts b, the least recently written
    expect(cache.get('b')).toBeNull();
    expect(cache.get('a')).not.toBeNull();
    expect(cache.get('c')).not.toBeNull();
  });

  it('drops corrupt entries and a corrupt index without throwing', () => {
    const store = new MemoryKeyValueStore();
    const cache = new ValhallaCache(store);
    store.set(`${CACHE_ENTRY_PREFIX}bad`, '{nope');
    expect(cache.get('bad')).toBeNull();
    expect(store.getString(`${CACHE_ENTRY_PREFIX}bad`)).toBeUndefined();

    store.set(CACHE_INDEX_KEY, 'garbage');
    expect(() => cache.set('ok', raw)).not.toThrow();
    expect(cache.get('ok')).not.toBeNull();

    store.set(`${CACHE_ENTRY_PREFIX}old`, JSON.stringify({ savedAt: 1, raw: { shape: [] } }));
    expect(cache.get('old')).toBeNull();
  });
});

describe('planRoutes with the cache (fair use on public servers)', () => {
  it('stores every live response, then answers a repeat request with zero network calls', async () => {
    const store = new MemoryKeyValueStore();
    const cache = new ValhallaCache(store);
    const fetchMock = okFetch();

    const first = await planRoutes({ origin, destination, baseUrl: LIVE, fetch: fetchMock, cache });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(first.cachedProfiles).toEqual([]);

    const second = await planRoutes({ origin, destination, baseUrl: LIVE, fetch: fetchMock, cache });
    expect(fetchMock).toHaveBeenCalledTimes(3); // unchanged
    expect(second.cachedProfiles).toHaveLength(3);
    expect(second.routes[0].steps.find((s) => s.exitNumber === '1201B')).toBeDefined();
    expect(second.routes[0].distanceM).toBe(first.routes[0].distanceM);
  });

  it('serves a stale cached route when the network is down (re-route in a dead zone)', async () => {
    const store = new MemoryKeyValueStore();
    let now = 0;
    const cache = new ValhallaCache(store, { now: () => now });
    await planRoutes({ origin, destination, baseUrl: LIVE, fetch: okFetch(), cache });

    now += CACHE_TTL_MS * 4;
    const offline = jest.fn(async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;
    const result = await planRoutes({ origin, destination, baseUrl: LIVE, fetch: offline, cache });
    expect(result.routes.length).toBeGreaterThan(0);
    expect(result.cachedProfiles).toHaveLength(3);
  });

  it('still fails cleanly with no cache and no network', async () => {
    const offline = jest.fn(async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;
    await expect(planRoutes({ origin, destination, baseUrl: LIVE, fetch: offline, cache: new ValhallaCache(new MemoryKeyValueStore()) })).rejects.toThrow(/routing server/i);
  });

  it('does not cache failed responses', async () => {
    const store = new MemoryKeyValueStore();
    const cache = new ValhallaCache(store);
    const bad = jest.fn(async () => ({ ok: false, status: 429 }) as Response) as unknown as typeof fetch;
    await expect(planRoutes({ origin, destination, baseUrl: LIVE, fetch: bad, cache })).rejects.toThrow();
    expect(store.getString(CACHE_INDEX_KEY)).toBeUndefined();
  });

  it('a re-route can request just the profile being driven', async () => {
    const fetchMock = okFetch();
    const result = await planRoutes({ origin, destination, baseUrl: LIVE, fetch: fetchMock, profiles: ['avoid_tolls'] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.routes.map((r) => r.profile)).toEqual(['avoid_tolls']);
  });
});
