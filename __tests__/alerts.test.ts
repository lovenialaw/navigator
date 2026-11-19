import { ALERT_CACHE_KEY, ALERT_TTL_MS, loadAlerts } from '../src/alerts/alertFeed';
import { alertSchema, parseAlertFeed } from '../src/alerts/alertTypes';
import { MemoryKeyValueStore } from '../src/storage/keyValueStore';

const NOW = 1_800_000_000_000;
const good = { id: 'a1', kind: 'flood', title: 'Banjir Sg Pahang', severity: 'danger', source: 'JPS', lng: 102.4, lat: 3.5, radiusM: 3000 };

describe('parseAlertFeed', () => {
  it('accepts {alerts: [...]} and a bare array', () => {
    expect(parseAlertFeed({ alerts: [good] }, NOW)).toHaveLength(1);
    expect(parseAlertFeed([good], NOW)).toHaveLength(1);
  });

  it('falls back safely for missing optional fields', () => {
    const [alert] = parseAlertFeed([{ id: 'x', kind: 'landslide', title: 'Tanah runtuh', lng: 101, lat: 3 }], NOW);
    expect(alert).toMatchObject({ severity: 'warning', source: 'other', radiusM: 2000 });
  });

  it('keeps an alert with an unknown severity or source rather than hiding a hazard', () => {
    const [alert] = parseAlertFeed([{ ...good, severity: 'catastrophic', source: 'Somebody' }], NOW);
    expect(alert.severity).toBe('warning');
    expect(alert.source).toBe('other');
    expect(parseAlertFeed([{ ...good, source: 'jps' }], NOW)[0].source).toBe('JPS');
  });

  it('strips HTML from titles', () => {
    const [alert] = parseAlertFeed([{ ...good, title: '<b>Banjir</b> <img src=x onerror=alert(1)> Kuantan' }], NOW);
    expect(alert.title).not.toMatch(/[<>]/);
    expect(alert.title).toContain('Banjir');
  });

  it('drops malformed, duplicate and expired alerts without losing the rest', () => {
    const alerts = parseAlertFeed(
      [
        null,
        { id: 'nope' },
        { ...good, lat: 999 },
        { ...good, kind: 'tsunami' },
        { ...good, title: '<br>' }, // nothing left after stripping
        { ...good, id: 'old', expiresAt: NOW - 1 },
        good,
        { ...good, title: 'duplicate id' },
        { ...good, id: 'huge', radiusM: 500_000 },
      ],
      NOW,
    );
    expect(alerts.map((a) => a.id)).toEqual(['a1']);
  });

  it('returns nothing for a garbage feed', () => {
    expect(parseAlertFeed('rate limited', NOW)).toEqual([]);
    expect(parseAlertFeed({ alerts: 5 }, NOW)).toEqual([]);
    expect(alertSchema.safeParse(null).success).toBe(false);
  });
});

describe('loadAlerts', () => {
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

  it('does nothing without a configured feed', async () => {
    const result = await loadAlerts({ store: new MemoryKeyValueStore(), url: null, now: () => NOW });
    expect(result).toEqual({ alerts: [], source: 'none' });
  });

  it('fetches, caches, then serves from the cache inside the TTL', async () => {
    const store = new MemoryKeyValueStore();
    const fake = jest.fn(async () => ok({ alerts: [good] }));
    const first = await loadAlerts({ store, url: 'https://feed.example/a', fetch: fake as never, now: () => NOW });
    expect(first.source).toBe('network');
    const second = await loadAlerts({ store, url: 'https://feed.example/a', fetch: fake as never, now: () => NOW + 60_000 });
    expect(second).toMatchObject({ source: 'cache' });
    expect(second.alerts).toHaveLength(1);
    expect(fake).toHaveBeenCalledTimes(1);
  });

  it('serves the last alerts when offline, minus any that expired meanwhile', async () => {
    const store = new MemoryKeyValueStore();
    const feed = { alerts: [{ ...good, expiresAt: NOW + 3_600_000 }, { ...good, id: 'short', expiresAt: NOW + 60_000 }] };
    await loadAlerts({ store, url: 'https://feed.example/a', fetch: (async () => ok(feed)) as never, now: () => NOW });
    const offline = jest.fn(async () => {
      throw new TypeError('Network request failed');
    });
    const later = NOW + ALERT_TTL_MS + 120_000;
    const result = await loadAlerts({ store, url: 'https://feed.example/a', fetch: offline as never, now: () => later });
    expect(result.source).toBe('stale');
    expect(result.alerts.map((a) => a.id)).toEqual(['a1']);
  });

  it('returns nothing, without throwing, when offline with no cache', async () => {
    const offline = jest.fn(async () => {
      throw new TypeError('Network request failed');
    });
    const result = await loadAlerts({ store: new MemoryKeyValueStore(), url: 'https://feed.example/a', fetch: offline as never, now: () => NOW });
    expect(result).toEqual({ alerts: [], source: 'none' });
  });

  it('survives a corrupt cache', async () => {
    const store = new MemoryKeyValueStore();
    store.set(ALERT_CACHE_KEY, '{not json');
    const result = await loadAlerts({ store, url: 'https://feed.example/a', fetch: (async () => ok({ alerts: [good] })) as never, now: () => NOW });
    expect(result.source).toBe('network');
  });
});
