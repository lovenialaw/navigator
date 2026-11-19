import { DEMO_VALHALLA_BASE_URL } from '../src/config/tujuConfig';
import { MAX_WAYPOINTS, plannedRouteSchema, type Place } from '../src/routing/routeTypes';
import { encodePolyline } from '../src/routing/polyline';
import { cacheKeyFor } from '../src/routing/valhallaCache';
import {
  buildValhallaRequest,
  normalizeValhalla,
  planRoutes,
  valhallaResponseSchema,
} from '../src/routing/valhallaClient';
import { orderStops, remainingStops, withStop } from '../src/navigation/stops';
import { buildRouteGeometry } from '../src/utils/mapMatcher';
import type { LngLat } from '../src/utils/geo';

const KLCC = { lng: 101.7116, lat: 3.1579 };
const sunway: Place = { id: 'p1', name: 'Sunway Pyramid', subtitle: 'Selangor', lng: 101.6071, lat: 3.0728 };
const midValley: Place = { id: 'osm:node:1', name: 'Sample R&R', subtitle: 'R&R', lng: 101.6772, lat: 3.1186 };

const legA: LngLat[] = [[101, 3], [101.05, 3], [101.1, 3]];
const legB: LngLat[] = [[101.1, 3], [101.15, 3], [101.2, 3]];

function twoLegResponse() {
  const maneuvers = (arrive: string) => [
    { type: 1, instruction: 'Drive east.', length: 5.5, time: 300, begin_shape_index: 0, end_shape_index: 1, street_names: ['Jalan A'] },
    { type: 4, instruction: arrive, length: 0, time: 0, begin_shape_index: 2, end_shape_index: 2 },
  ];
  return {
    trip: {
      legs: [
        { shape: encodePolyline(legA), maneuvers: maneuvers('You have arrived at your destination.') },
        { shape: encodePolyline(legB), maneuvers: maneuvers('You have arrived at your destination.') },
      ],
      summary: { length: 22, time: 1200, has_toll: false, has_ferry: false },
    },
  };
}

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

describe('requests with stops', () => {
  it('sends origin, each stop and the destination as break points', () => {
    const request = buildValhallaRequest('fastest', KLCC, sunway, [midValley]);
    expect(request.locations).toEqual([
      { lat: KLCC.lat, lon: KLCC.lng, type: 'break' },
      { lat: midValley.lat, lon: midValley.lng, type: 'break' },
      { lat: sunway.lat, lon: sunway.lng, type: 'break' },
    ]);
  });

  it('keeps old cache keys and gives a trip with stops its own key', () => {
    const plain = cacheKeyFor('fastest', KLCC, sunway);
    expect(plain).toBe(cacheKeyFor('fastest', KLCC, sunway, []));
    expect(cacheKeyFor('fastest', KLCC, sunway, [midValley])).not.toBe(plain);
    expect(cacheKeyFor('fastest', KLCC, sunway, [midValley])).toContain('via:');
  });
});

describe('normalizeValhalla with stops', () => {
  const parsed = valhallaResponseSchema.parse(twoLegResponse());

  it('joins legs, shifts shape indices and renames the stop arrival', () => {
    const route = normalizeValhalla(parsed, ['Shell Ayer Keroh']);
    expect(route.shape).toHaveLength(5);
    expect(route.steps.map((s) => s.instruction)).toEqual([
      'Drive east.',
      'Stop at Shell Ayer Keroh',
      'Drive east.',
      'You have arrived at your destination.',
    ]);
    expect(route.steps[2].beginShapeIndex).toBe(2);
    expect(route.steps[3].beginShapeIndex).toBe(4);
  });

  it('never rewrites the final arrival, and strips HTML from the stop name', () => {
    const route = normalizeValhalla(parsed, ['<b>Petronas</b>']);
    expect(route.steps[1].instruction).not.toMatch(/[<>]/);
    expect(route.steps[3].instruction).toBe('You have arrived at your destination.');
  });
});

describe('planRoutes with a stop', () => {
  it('keeps the final destination and records the stop (live)', async () => {
    const fake = jest.fn(async () => ok(twoLegResponse()));
    const result = await planRoutes({
      origin: KLCC,
      destination: sunway,
      waypoints: [midValley],
      baseUrl: 'https://valhalla.example.com',
      profiles: ['fastest'],
      fetch: fake as never,
    });
    const body = JSON.parse(((fake.mock.calls[0] as unknown) as [string, RequestInit])[1].body as string);
    expect(body.locations).toHaveLength(3);
    expect(result.routes[0].destination).toEqual(sunway);
    expect(result.routes[0].waypoints).toEqual([midValley]);
  });

  it('builds a joined sample trip in demo mode', async () => {
    const { routes, mock } = await planRoutes({
      origin: KLCC,
      destination: sunway,
      waypoints: [midValley],
      baseUrl: DEMO_VALHALLA_BASE_URL,
    });
    expect(mock).toBe(true);
    const route = routes[0];
    expect(route.waypoints).toEqual([midValley]);
    expect(route.destination).toEqual(sunway);
    const last = route.shape[route.shape.length - 1];
    expect(last[0]).toBeCloseTo(sunway.lng, 4);
    expect(last[1]).toBeCloseTo(sunway.lat, 4);
    const names = route.steps.map((s) => s.instruction);
    expect(names).toContain('Stop at Sample R&R');
    expect(names[names.length - 1]).toBe(`Arrive at ${sunway.name}`);
    for (const step of route.steps) {
      expect(step.beginShapeIndex).toBeLessThan(route.shape.length);
      expect(step.endShapeIndex).toBeLessThan(route.shape.length);
      expect(step.endShapeIndex).toBeGreaterThanOrEqual(step.beginShapeIndex);
    }
  });

  it('reads a route saved before stops existed', async () => {
    const { routes } = await planRoutes({ origin: KLCC, destination: sunway, baseUrl: DEMO_VALHALLA_BASE_URL });
    const { waypoints: _omit, ...legacy } = routes[0];
    expect(plannedRouteSchema.parse(legacy).waypoints).toEqual([]);
  });

  it('refuses more stops than the limit when saved', async () => {
    const { routes } = await planRoutes({ origin: KLCC, destination: sunway, baseUrl: DEMO_VALHALLA_BASE_URL });
    const tooMany = Array.from({ length: MAX_WAYPOINTS + 1 }, (_, i) => ({ ...midValley, id: `s${i}` }));
    expect(plannedRouteSchema.safeParse({ ...routes[0], waypoints: tooMany }).success).toBe(false);
  });
});

describe('stop ordering', () => {
  // East-west road, 22 km. Stops at roughly 5.5 km, 11 km, 16.5 km.
  const shape: LngLat[] = Array.from({ length: 21 }, (_, i) => [101 + i * 0.01, 3] as const);
  const geometry = buildRouteGeometry(shape, []);
  const stop = (id: string, lng: number): Place => ({ id, name: id, subtitle: '', lng, lat: 3.001 });

  it('orders stops by where the route reaches them', () => {
    const ordered = orderStops(geometry, [stop('c', 101.15), stop('a', 101.05), stop('b', 101.1)]);
    expect(ordered.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('drops stops already reached so a re-route does not send the driver back', () => {
    const stops = [stop('a', 101.05), stop('b', 101.1), stop('c', 101.15)];
    expect(remainingStops(geometry, stops, 0).map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(remainingStops(geometry, stops, 8000).map((s) => s.id)).toEqual(['b', 'c']);
    expect(remainingStops(geometry, stops, 20_000)).toEqual([]);
  });

  it('adds a stop in route order, rejects duplicates and enforces the limit', () => {
    const added = withStop(geometry, [stop('c', 101.15)], 0, stop('a', 101.05));
    expect(added.ok && added.stops.map((s) => s.id)).toEqual(['a', 'c']);

    const duplicate = withStop(geometry, [stop('a', 101.05)], 0, stop('a', 101.05));
    expect(duplicate.ok).toBe(false);

    const full = Array.from({ length: MAX_WAYPOINTS }, (_, i) => stop(`s${i}`, 101.02 + i * 0.01));
    const rejected = withStop(geometry, full, 0, stop('extra', 101.18));
    expect(rejected.ok).toBe(false);
    // A stop already passed no longer counts against the limit.
    expect(withStop(geometry, full, 15_000, stop('extra', 101.18)).ok).toBe(true);
  });
});
