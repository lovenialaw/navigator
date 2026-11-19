import {
  DEMO_PHOTON_BASE_URL,
  DEMO_VALHALLA_BASE_URL,
  buildConfig,
  isPlaceholderUrl,
} from '../src/config/tujuConfig';
import { encodePolyline } from '../src/routing/polyline';
import { ROUTE_PROFILES, type Place } from '../src/routing/routeTypes';
import {
  ACTIVE_ROUTE_KEY,
  ROUTE_CANDIDATES_KEY,
  clearActiveRoute,
  loadActiveRoute,
  loadRouteCandidates,
  saveActiveRoute,
  saveRouteCandidates,
} from '../src/routing/routeStore';
import { RoutePlanError, buildValhallaRequest, planRoutes } from '../src/routing/valhallaClient';
import { MemoryKeyValueStore } from '../src/storage/keyValueStore';
import { bundledTollData, type LngLat } from '../src/utils/tollCalculator';

const LIVE_URL = 'https://valhalla.example.com';

const KLCC = { lng: 101.7116, lat: 3.1579 };
const sunway: Place = { id: 'p1', name: 'Sunway Pyramid', subtitle: 'Selangor', lng: 101.6071, lat: 3.0728 };
const guaMusang: Place = { id: 'p2', name: 'Gua Musang', subtitle: 'Kelantan', lng: 101.9667, lat: 4.8833 };

function through(...codes: string[]): LngLat[] {
  const all = bundledTollData.highways.flatMap((h) => h.plazas);
  return codes.map((code) => {
    const plaza = all.find((p) => p.plazaCode === code);
    if (!plaza) throw new Error(`unknown plaza ${code}`);
    return [plaza.lng, plaza.lat] as const;
  });
}

function valhallaBody(shape: LngLat[], extra: { has_toll?: boolean; instruction?: unknown } = {}) {
  return {
    trip: {
      legs: [
        {
          shape: encodePolyline(shape),
          maneuvers: [
            { type: 1, instruction: extra.instruction ?? 'Drive north.', length: 4.2, time: 300, begin_shape_index: 0, street_names: ['Jalan Ampang'] },
            { type: 4, instruction: 'You have arrived.', length: 0, time: 0, begin_shape_index: shape.length - 1 },
          ],
        },
      ],
      summary: { length: 18.5, time: 1260, has_toll: extra.has_toll ?? false, has_ferry: false },
    },
  };
}

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

describe('config', () => {
  it('can be forced into demo mode with .invalid hosts', () => {
    const config = buildConfig({
      EXPO_PUBLIC_TUJU_VALHALLA_URL: DEMO_VALHALLA_BASE_URL,
      EXPO_PUBLIC_TUJU_PHOTON_URL: DEMO_PHOTON_BASE_URL,
    });
    expect(isPlaceholderUrl(config.valhallaBaseUrl)).toBe(true);
    expect(isPlaceholderUrl(config.photonBaseUrl)).toBe(true);
  });

  it('accepts overrides and trims trailing slashes', () => {
    const config = buildConfig({
      EXPO_PUBLIC_TUJU_VALHALLA_URL: 'https://valhalla.example.com//',
      EXPO_PUBLIC_TUJU_PHOTON_URL: ' https://photon.example.com/ ',
    });
    expect(config.valhallaBaseUrl).toBe('https://valhalla.example.com');
    expect(config.photonBaseUrl).toBe('https://photon.example.com');
    expect(isPlaceholderUrl(config.valhallaBaseUrl)).toBe(false);
  });

  it('rejects a malformed override', () => {
    expect(() => buildConfig({ EXPO_PUBLIC_TUJU_VALHALLA_URL: 'javascript:alert(1)' })).toThrow();
  });
});

describe('buildValhallaRequest', () => {
  it('encodes the three profiles with distinct costing options', () => {
    const req = (p: (typeof ROUTE_PROFILES)[number]) => buildValhallaRequest(p, KLCC, sunway);
    expect(req('fastest').costing_options.auto).toEqual({ use_highways: 1, use_tolls: 1 });
    expect(req('avoid_tolls').costing_options.auto).toEqual({ use_tolls: 0 });
    expect(req('trunk_roads').costing_options.auto).toMatchObject({ use_highways: 0, use_tolls: 0 });
    expect(req('fastest').locations).toEqual([
      { lat: KLCC.lat, lon: KLCC.lng, type: 'break' },
      { lat: sunway.lat, lon: sunway.lng, type: 'break' },
    ]);
    expect(req('fastest').directions_options.units).toBe('kilometers');
  });
});

describe('planRoutes: live endpoint', () => {
  const ldp = through('LDP-PEN', 'LDP-PJS', 'LDP-PCB', 'LDP-PCS');
  const free: LngLat[] = [
    [101.7116, 3.1579],
    [101.715, 3.12],
    [101.725, 3.07],
    [101.6071, 3.0728],
  ];

  function fakeFetch(handler: (profile: string) => Response | Promise<Response>) {
    return jest.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      return handler(body.id);
    }) as unknown as jest.MockedFunction<typeof fetch>;
  }

  it('posts one request per profile to <base>/route and prices tolls offline', async () => {
    const fetchMock = fakeFetch((profile) => okResponse(valhallaBody(profile === 'fastest' ? ldp : free)));
    const result = await planRoutes({ origin: KLCC, destination: sunway, baseUrl: `${LIVE_URL}/`, fetch: fetchMock });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toBe(`${LIVE_URL}/route`);
    expect(result.mock).toBe(false);

    const fastest = result.routes.find((r) => r.profile === 'fastest');
    expect(fastest?.toll.totalRinggit).toBe(8.4);
    expect(fastest?.toll.isEstimate).toBe(true);
    expect(fastest?.toll.charges.map((c) => c.highwayShortName)).toEqual(['LDP', 'LDP', 'LDP', 'LDP']);
    expect(fastest?.distanceM).toBe(18500);
    expect(fastest?.durationSec).toBe(1260);

    // avoid_tolls and trunk_roads returned the same road, so they merge into one card.
    const noTolls = result.routes.find((r) => r.profile === 'avoid_tolls');
    expect(noTolls?.toll.totalRinggit).toBe(0);
    expect(noTolls?.alsoProfiles).toEqual(['trunk_roads']);
    expect(result.routes).toHaveLength(2);
  });

  it('keeps going when one profile fails and reports it', async () => {
    const fetchMock = fakeFetch((profile) =>
      profile === 'trunk_roads' ? ({ ok: false, status: 500 } as Response) : okResponse(valhallaBody(profile === 'fastest' ? ldp : free)),
    );
    const result = await planRoutes({ origin: KLCC, destination: sunway, baseUrl: LIVE_URL, fetch: fetchMock });
    expect(result.failedProfiles).toEqual(['trunk_roads']);
    expect(result.routes.map((r) => r.profile)).toEqual(['fastest', 'avoid_tolls']);
  });

  it('throws RoutePlanError when every profile fails', async () => {
    const fetchMock = fakeFetch(() => ({ ok: false, status: 503 }) as Response);
    await expect(planRoutes({ origin: KLCC, destination: sunway, baseUrl: LIVE_URL, fetch: fetchMock })).rejects.toBeInstanceOf(RoutePlanError);
  });

  it('turns a network error into a friendly RoutePlanError', async () => {
    const fetchMock = jest.fn(async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;
    await expect(planRoutes({ origin: KLCC, destination: sunway, baseUrl: LIVE_URL, fetch: fetchMock })).rejects.toThrow(/routing server/i);
  });

  it('rejects structurally invalid and undecodable responses', async () => {
    const bad = fakeFetch(() => okResponse({ trip: { legs: [] } }));
    await expect(planRoutes({ origin: KLCC, destination: sunway, baseUrl: LIVE_URL, fetch: bad })).rejects.toBeInstanceOf(RoutePlanError);

    const garbage = fakeFetch(() => okResponse({ trip: { legs: [{ shape: '\u0001\u0001' }], summary: { length: 1, time: 1 } } }));
    await expect(planRoutes({ origin: KLCC, destination: sunway, baseUrl: LIVE_URL, fetch: garbage })).rejects.toBeInstanceOf(RoutePlanError);
  });

  it('strips HTML from instructions and tolerates missing optional fields', async () => {
    const body = valhallaBody(ldp, { instruction: '<b>Turn</b> left onto <script>alert(1)</script>Jalan Ampang &amp; more' });
    const fetchMock = fakeFetch(() => okResponse(body));
    const result = await planRoutes({ origin: KLCC, destination: sunway, baseUrl: LIVE_URL, fetch: fetchMock });
    const instruction = result.routes[0].steps[0].instruction;
    expect(instruction).not.toMatch(/[<>&]/);
    expect(instruction).toContain('Turn left onto');
  });

  it('warns when Valhalla reports tolls we cannot price', async () => {
    const fetchMock = fakeFetch(() => okResponse(valhallaBody(free, { has_toll: true })));
    const result = await planRoutes({ origin: KLCC, destination: sunway, baseUrl: LIVE_URL, fetch: fetchMock });
    expect(result.routes[0].warnings.map((w) => w.kind)).toContain('toll_incomplete');
  });

  it('passes the abort signal through', async () => {
    const controller = new AbortController();
    const fetchMock = jest.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    ) as unknown as typeof fetch;
    const pending = planRoutes({ origin: KLCC, destination: sunway, baseUrl: LIVE_URL, fetch: fetchMock, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow(/cancelled/i);
  });
});

describe('planRoutes: mock mode (.invalid endpoint)', () => {
  const neverFetch = jest.fn(() => {
    throw new Error('network must not be touched in mock mode');
  }) as unknown as typeof fetch;

  it('makes zero network calls and returns three distinct sample routes', async () => {
    const result = await planRoutes({ origin: KLCC, destination: sunway, baseUrl: DEMO_VALHALLA_BASE_URL, fetch: neverFetch });
    expect(neverFetch).not.toHaveBeenCalled();
    expect(result.mock).toBe(true);
    expect(result.routes.map((r) => r.profile)).toEqual(['fastest', 'avoid_tolls', 'trunk_roads']);
    expect(result.routes.every((r) => r.mock)).toBe(true);
  });

  it('exercises the toll calculator: LDP route, MEX route and a toll-free route', async () => {
    const { routes } = await planRoutes({ origin: KLCC, destination: sunway, baseUrl: DEMO_VALHALLA_BASE_URL });
    const byProfile = Object.fromEntries(routes.map((r) => [r.profile, r]));

    expect(byProfile.fastest.toll.charges.length).toBeGreaterThan(0);
    expect(byProfile.fastest.toll.charges.every((c) => c.highwayShortName === 'LDP')).toBe(true);
    expect(byProfile.trunk_roads.toll.charges.length).toBeGreaterThan(0);
    expect(byProfile.trunk_roads.toll.charges.every((c) => c.highwayShortName === 'MEX')).toBe(true);
    expect(byProfile.avoid_tolls.toll.totalRinggit).toBe(0);
    expect(byProfile.avoid_tolls.warnings.map((w) => w.kind).sort()).toEqual(['flood_prone', 'unpaved']);
  });

  it('is toll-free for trips that stay away from every known plaza', async () => {
    const sabah: Place = { id: 'kk', name: 'Sepanggar', subtitle: 'Sabah', lng: 116.12, lat: 6.05 };
    const { routes } = await planRoutes({
      origin: { lng: 116.051, lat: 5.937 },
      destination: sabah,
      baseUrl: DEMO_VALHALLA_BASE_URL,
    });
    expect(routes).toHaveLength(3);
    routes.forEach((r) => expect(r.toll.totalRinggit).toBe(0));
    expect(new Set(routes.map((r) => r.durationSec)).size).toBe(3);
  });

  it('prices a long sample trip like a real one (KL to Gua Musang crosses DUKE)', async () => {
    const { routes } = await planRoutes({ origin: KLCC, destination: guaMusang, baseUrl: DEMO_VALHALLA_BASE_URL });
    expect(routes.length).toBeGreaterThanOrEqual(1);
    routes.forEach((r) => {
      expect(Number.isFinite(r.toll.totalRinggit)).toBe(true);
      expect(r.shape[r.shape.length - 1]).toEqual([guaMusang.lng, guaMusang.lat]);
    });
  });

  it('produces step lists that end at the destination', async () => {
    const { routes } = await planRoutes({ origin: KLCC, destination: sunway, baseUrl: DEMO_VALHALLA_BASE_URL });
    for (const route of routes) {
      const last = route.steps[route.steps.length - 1];
      expect(last.instruction).toBe('Arrive at Sunway Pyramid');
      expect(last.location).toEqual([sunway.lng, sunway.lat]);
    }
  });
});

describe('routeStore', () => {
  async function sampleRoutes() {
    return (await planRoutes({ origin: KLCC, destination: sunway, baseUrl: DEMO_VALHALLA_BASE_URL })).routes;
  }

  it('round-trips the active route through the key-value store', async () => {
    const store = new MemoryKeyValueStore();
    const [route] = await sampleRoutes();
    expect(loadActiveRoute(store)).toBeNull();
    saveActiveRoute(store, route);
    expect(loadActiveRoute(store)).toEqual(route);
    clearActiveRoute(store);
    expect(loadActiveRoute(store)).toBeNull();
  });

  it('round-trips candidates', async () => {
    const store = new MemoryKeyValueStore();
    const routes = await sampleRoutes();
    saveRouteCandidates(store, routes);
    expect(loadRouteCandidates(store)).toEqual(routes);
  });

  it('drops corrupt or outdated data instead of crashing', () => {
    const store = new MemoryKeyValueStore();
    store.set(ACTIVE_ROUTE_KEY, '{not json');
    expect(loadActiveRoute(store)).toBeNull();
    expect(store.getString(ACTIVE_ROUTE_KEY)).toBeUndefined();

    store.set(ROUTE_CANDIDATES_KEY, JSON.stringify([{ id: 'old-format' }]));
    expect(loadRouteCandidates(store)).toEqual([]);
    expect(store.getString(ROUTE_CANDIDATES_KEY)).toBeUndefined();
  });
});
