import {
  FALLBACK_STYLE,
  STYLE_CACHE_KEY,
  applyPackToStyle,
  loadStyleJson,
  parseStyle,
  resolveMapStyle,
  toPmtilesUrl,
  type FetchLike,
  type MapStyle,
} from '../src/map/styleResolver';
import { MemoryKeyValueStore } from '../src/storage/keyValueStore';

const remoteStyle: MapStyle = {
  version: 8,
  sources: {
    malaysia: { type: 'vector', url: 'pmtiles://https://cdn.example.com/malaysia.pmtiles', attribution: 'OSM' },
    other: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } as never,
  },
  layers: [{ id: 'bg', type: 'background' }],
};

const okFetch = (body: unknown): FetchLike => async () => ({ ok: true, json: async () => body });
const failingFetch: FetchLike = async () => {
  throw new Error('offline');
};

describe('applyPackToStyle', () => {
  it('swaps the named vector source for the local archive and keeps other fields', () => {
    const result = applyPackToStyle(remoteStyle, 'malaysia', 'file:///d/sabah.pmtiles');
    expect(result?.sources.malaysia).toEqual({
      type: 'vector',
      url: 'pmtiles://file:///d/sabah.pmtiles',
      attribution: 'OSM',
    });
    expect(result?.sources.other).toBe(remoteStyle.sources.other);
    expect(remoteStyle.sources.malaysia.url).toContain('https://cdn.example.com');
  });

  it('drops a tiles array so it cannot override the archive', () => {
    const style: MapStyle = { ...remoteStyle, sources: { malaysia: { type: 'vector', tiles: ['https://x/{z}/{x}/{y}.pbf'] } } };
    expect(applyPackToStyle(style, 'malaysia', 'file:///a.pmtiles')?.sources.malaysia).not.toHaveProperty('tiles');
  });

  it('falls back to the first vector source when the id differs, and null when there is none', () => {
    expect(applyPackToStyle(remoteStyle, 'renamed', 'file:///a.pmtiles')?.sources.malaysia.url).toBe('pmtiles://file:///a.pmtiles');
    expect(applyPackToStyle(FALLBACK_STYLE, 'malaysia', 'file:///a.pmtiles')).toBeNull();
  });

  it('builds pmtiles:// URLs', () => {
    expect(toPmtilesUrl('file:///x.pmtiles')).toBe('pmtiles://file:///x.pmtiles');
  });
});

describe('parseStyle', () => {
  it('accepts a valid style and rejects junk', () => {
    expect(parseStyle(remoteStyle)).not.toBeNull();
    expect(parseStyle({ version: 7, sources: {}, layers: [] })).toBeNull();
    expect(parseStyle('<html>')).toBeNull();
    expect(parseStyle({ version: 8, sources: {} })).toBeNull();
  });
});

describe('loadStyleJson', () => {
  it('uses the network and caches the style', async () => {
    const storage = new MemoryKeyValueStore();
    const result = await loadStyleJson('https://s/style.json', { fetch: okFetch(remoteStyle), storage });
    expect(result?.source).toBe('network');
    expect(storage.getString(STYLE_CACHE_KEY)).toContain('https://s/style.json');
  });

  it('serves the cached copy when offline, but only for the same URL', async () => {
    const storage = new MemoryKeyValueStore();
    await loadStyleJson('https://s/style.json', { fetch: okFetch(remoteStyle), storage });
    expect((await loadStyleJson('https://s/style.json', { fetch: failingFetch, storage }))?.source).toBe('cache');
    expect(await loadStyleJson('https://other/style.json', { fetch: failingFetch, storage })).toBeNull();
  });

  it('does not cache or return an invalid style from the network', async () => {
    const storage = new MemoryKeyValueStore();
    expect(await loadStyleJson('https://s/style.json', { fetch: okFetch({ nope: true }), storage })).toBeNull();
    expect(storage.getString(STYLE_CACHE_KEY)).toBeUndefined();
  });

  it('survives a corrupt cache entry', async () => {
    const storage = new MemoryKeyValueStore();
    storage.set(STYLE_CACHE_KEY, '{bad');
    expect(await loadStyleJson('https://s/style.json', { fetch: failingFetch, storage })).toBeNull();
  });
});

describe('resolveMapStyle', () => {
  const base = { styleSourceId: 'malaysia', storage: new MemoryKeyValueStore() };

  it('passes the hosted URL straight through when no pack is active', async () => {
    const result = await resolveMapStyle({ ...base, styleUrl: 'https://s/style.json', activePackFileUri: null, fetch: failingFetch });
    expect(result).toEqual({ kind: 'url', mapStyle: 'https://s/style.json', note: null });
  });

  it('uses the bundled fallback for a placeholder URL so launch never blocks', async () => {
    const result = await resolveMapStyle({ ...base, styleUrl: 'https://tiles.tuju.invalid/s.json', activePackFileUri: null, fetch: failingFetch });
    expect(result).toMatchObject({ kind: 'object', mapStyle: FALLBACK_STYLE, note: 'style-not-configured' });
  });

  it('rewrites the style for an active pack, working offline from the cached style', async () => {
    const storage = new MemoryKeyValueStore();
    await loadStyleJson('https://s/style.json', { fetch: okFetch(remoteStyle), storage });
    const result = await resolveMapStyle({ styleUrl: 'https://s/style.json', styleSourceId: 'malaysia', storage, activePackFileUri: 'file:///sabah.pmtiles', fetch: failingFetch });
    expect(result.kind).toBe('object');
    expect(result.note).toBeNull();
    expect((result.mapStyle as MapStyle).sources.malaysia.url).toBe('pmtiles://file:///sabah.pmtiles');
  });

  it('reports style-unavailable when a pack is active but no style was ever fetched', async () => {
    const result = await resolveMapStyle({ ...base, storage: new MemoryKeyValueStore(), styleUrl: 'https://s/style.json', activePackFileUri: 'file:///a.pmtiles', fetch: failingFetch });
    expect(result).toMatchObject({ kind: 'object', note: 'style-unavailable' });
  });

  it('flags a style with no vector source to replace', async () => {
    const style: MapStyle = { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background' }] };
    const result = await resolveMapStyle({ ...base, storage: new MemoryKeyValueStore(), styleUrl: 'https://s/style.json', activePackFileUri: 'file:///a.pmtiles', fetch: okFetch(style) });
    expect(result.note).toBe('pack-not-applicable');
  });
});
