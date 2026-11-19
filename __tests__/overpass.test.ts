import {
  CORRIDOR_RADIUS_M,
  PoiFetchError,
  buildOverpassQuery,
  corridorPoints,
  fetchRoutePois,
  parseOverpass,
} from '../src/poi/overpassClient';
import { detectBrand } from '../src/poi/poiTypes';
import type { LngLat } from '../src/utils/geo';

const shape: LngLat[] = Array.from({ length: 41 }, (_, i) => [101 + i * 0.01, 3] as const);

const node = (id: number, tags: Record<string, unknown>, lat = 3.001, lon = 101.1) => ({
  type: 'node',
  id,
  lat,
  lon,
  tags,
});

describe('detectBrand', () => {
  it('tests petronas before petron', () => {
    expect(detectBrand({ name: 'Petronas Seremban' })).toBe('petronas');
    expect(detectBrand({ brand: 'Petron' })).toBe('petron');
  });

  it('recognises the other Malaysian brands and falls back to other', () => {
    expect(detectBrand({ brand: 'Shell' })).toBe('shell');
    expect(detectBrand({ operator: 'Caltex Malaysia' })).toBe('caltex');
    expect(detectBrand({ brand: 'BHPetrol' })).toBe('bhpetrol');
    expect(detectBrand({ name: 'Stesen Minyak Ah Kow' })).toBe('other');
  });
});

describe('parseOverpass', () => {
  it('classifies fuel, rest areas and EV chargers', () => {
    const pois = parseOverpass({
      elements: [
        node(1, { amenity: 'fuel', name: 'Petronas Ayer Keroh', brand: 'Petronas' }),
        node(2, { highway: 'services', name: 'R&R Seremban' }),
        node(3, { highway: 'rest_area' }),
        node(4, { amenity: 'charging_station', operator: 'Gentari' }),
      ],
    });
    expect(pois.map((p) => p.kind)).toEqual(['fuel', 'rnr', 'rnr', 'ev']);
    expect(pois[0]).toMatchObject({ id: 'osm:node:1', brand: 'petronas', name: 'Petronas Ayer Keroh' });
    expect(pois[1].name).toBe('R&R Seremban');
    expect(pois[2].name).toBe('Rest & Service Area');
    expect(pois[3]).toMatchObject({ operator: 'Gentari', name: 'Gentari' });
  });

  it('uses the centre of a way', () => {
    const [poi] = parseOverpass({
      elements: [{ type: 'way', id: 9, center: { lat: 3.2, lon: 101.5 }, tags: { amenity: 'fuel', name: 'Shell' } }],
    });
    expect(poi).toMatchObject({ id: 'osm:way:9', lat: 3.2, lng: 101.5 });
  });

  it('strips HTML and control characters from names', () => {
    const [poi] = parseOverpass({
      elements: [node(5, { amenity: 'fuel', name: '<b>Shell</b>\u0007 <script>alert(1)</script>Kajang' })],
    });
    expect(poi.name).not.toMatch(/[<>\u0007]/);
    expect(poi.name).toContain('Shell');
  });

  it('drops bad elements without losing the good ones', () => {
    const pois = parseOverpass({
      elements: [
        null,
        'nope',
        { type: 'node', id: 'x', lat: 3, lon: 101 },
        node(6, { amenity: 'fuel' }, 200, 101), // impossible latitude
        { type: 'node', id: 7, tags: { amenity: 'fuel' } }, // no position
        node(8, { amenity: 'fuel', access: 'private' }),
        node(9, { amenity: 'restaurant' }),
        node(10, { amenity: 'fuel', name: 'Good one' }),
        node(10, { amenity: 'fuel', name: 'Duplicate id' }),
      ],
    });
    expect(pois.map((p) => p.id)).toEqual(['osm:node:10']);
  });

  it('falls back to an empty list for a garbage response', () => {
    expect(parseOverpass(null)).toEqual([]);
    expect(parseOverpass({ elements: 'x' })).toEqual([]);
    expect(parseOverpass('<html>rate limited</html>')).toEqual([]);
  });
});

describe('corridor query', () => {
  it('spaces points so the search circles overlap, and keeps the last point', () => {
    const points = corridorPoints(shape);
    expect(points[0]).toEqual(shape[0]);
    expect(points[points.length - 1]).toEqual(shape[shape.length - 1]);
    // 44 km at 2.4 km spacing is about 19 points, never one per shape point.
    expect(points.length).toBeGreaterThan(10);
    expect(points.length).toBeLessThan(25);
  });

  it('caps the request size on very long routes', () => {
    const long: LngLat[] = Array.from({ length: 5000 }, (_, i) => [100 + i * 0.01, 3] as const);
    expect(corridorPoints(long).length).toBeLessThanOrEqual(350);
  });

  it('asks for all three kinds around the route', () => {
    const query = buildOverpassQuery(shape);
    expect(query).toContain('[out:json]');
    expect(query).toContain('"amenity"="fuel"');
    expect(query).toContain('"amenity"="charging_station"');
    expect(query).toContain('services|rest_area');
    expect(query).toContain(`around:${CORRIDOR_RADIUS_M},3.00000,101.00000`);
    expect(query).toContain('out center tags');
  });
});

describe('fetchRoutePois', () => {
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

  it('posts the query and parses the result', async () => {
    const fake = jest.fn(async () => ok({ elements: [node(1, { amenity: 'fuel', name: 'Shell' })] }));
    const pois = await fetchRoutePois({ overpassUrl: 'https://overpass.example.com/api', shape, fetch: fake as never });
    expect(pois).toHaveLength(1);
    const [url, init] = fake.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://overpass.example.com/api');
    expect(init.method).toBe('POST');
    expect(String(init.body)).toMatch(/^data=/);
  });

  it('turns a failure into a PoiFetchError instead of crashing', async () => {
    const bad = jest.fn(async () => ({ ok: false, status: 429, json: async () => ({}) }) as unknown as Response);
    await expect(fetchRoutePois({ overpassUrl: 'https://x.example', shape, fetch: bad as never })).rejects.toBeInstanceOf(
      PoiFetchError,
    );
    const offline = jest.fn(async () => {
      throw new TypeError('Network request failed');
    });
    await expect(
      fetchRoutePois({ overpassUrl: 'https://x.example', shape, fetch: offline as never }),
    ).rejects.toBeInstanceOf(PoiFetchError);
  });
});
