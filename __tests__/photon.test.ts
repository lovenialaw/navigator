import { DEMO_PHOTON_BASE_URL, PHOTON_BIAS } from '../src/config/tujuConfig';
import { searchMockPlaces } from '../src/search/mockPlaces';
import {
  MALAYSIA_BBOX,
  PlaceSearchError,
  parsePhotonResponse,
  searchPlaces,
} from '../src/search/photonClient';
import { sanitizeText } from '../src/utils/safeText';

const LIVE = 'https://photon.example.com';

function feature(props: Record<string, unknown>, coordinates: unknown = [101.6, 3.1]) {
  return { type: 'Feature', geometry: { type: 'Point', coordinates }, properties: { countrycode: 'MY', ...props } };
}

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

describe('sanitizeText', () => {
  it('strips tags, entities and control characters', () => {
    expect(sanitizeText('<b>KLCC</b><script>alert(1)</script> &amp; \u0007Park')).toBe('KLCC alert(1) Park');
    expect(sanitizeText(undefined)).toBe('');
    expect(sanitizeText(42)).toBe('');
    expect(sanitizeText('a'.repeat(500), 10)).toHaveLength(10);
  });
});

describe('mock places', () => {
  it('finds the sample Malaysian destinations', () => {
    expect(searchMockPlaces('klcc')[0].name).toMatch(/KLCC/);
    expect(searchMockPlaces('sunway pyramid').length).toBeGreaterThanOrEqual(2);
    expect(searchMockPlaces('putrajaya sentral')[0].name).toBe('Putrajaya Sentral');
    expect(searchMockPlaces('gua musang')[0].subtitle).toMatch(/Kelantan/);
    expect(searchMockPlaces('zzzz')).toEqual([]);
    expect(searchMockPlaces('   ')).toEqual([]);
  });
});

describe('parsePhotonResponse', () => {
  it('maps features to places with a readable subtitle', () => {
    const places = parsePhotonResponse({
      features: [
        feature({ name: 'Sunway Pyramid', street: 'Persiaran Lagoon', district: 'Bandar Sunway', city: 'Subang Jaya', state: 'Selangor', osm_type: 'W', osm_id: 123 }),
      ],
    });
    expect(places).toEqual([
      { id: 'W123', name: 'Sunway Pyramid', subtitle: 'Persiaran Lagoon, Bandar Sunway, Subang Jaya, Selangor', lng: 101.6, lat: 3.1 },
    ]);
  });

  it('drops malformed features and keeps the good ones', () => {
    const places = parsePhotonResponse({
      features: [
        null,
        'nope',
        { geometry: { coordinates: ['x', 'y'] }, properties: { name: 'Bad coords' } },
        feature({ name: 'Out of range' }, [500, 3]),
        feature({}, [101.6, 3.1]),
        feature({ name: 'Good', state: 12345 }),
      ],
    });
    expect(places.map((p) => p.name)).toEqual(['Good']);
  });

  it('removes HTML from names and falls back to street or city when name is missing', () => {
    const places = parsePhotonResponse({
      features: [
        feature({ name: '<img src=x onerror=alert(1)>Pavilion <b>KL</b>', osm_type: 'N', osm_id: 1 }),
        feature({ street: 'Jalan Ampang', osm_type: 'N', osm_id: 2 }),
        feature({ city: 'Kuala Lipis', osm_type: 'N', osm_id: 3 }),
      ],
    });
    expect(places.map((p) => p.name)).toEqual(['Pavilion KL', 'Jalan Ampang', 'Kuala Lipis']);
  });

  it('filters out results from other countries but keeps ones with no country code', () => {
    const places = parsePhotonResponse({
      features: [
        feature({ name: 'Singapore Zoo', countrycode: 'SG', osm_type: 'N', osm_id: 1 }),
        feature({ name: 'Kampung Baru', countrycode: undefined, osm_type: 'N', osm_id: 2 }),
      ],
    });
    expect(places.map((p) => p.name)).toEqual(['Kampung Baru']);
  });

  it('boosts mall parking entrances, malls and kampung names, keeping Photon order otherwise', () => {
    const places = parsePhotonResponse({
      features: [
        feature({ name: 'Random Cafe', osm_type: 'N', osm_id: 1 }),
        feature({ name: 'Another Shop', osm_type: 'N', osm_id: 2 }),
        feature({ name: 'Kampung Sungai Lembu', osm_type: 'N', osm_id: 3 }),
        feature({ name: 'Mall Central Parking Entrance B', osm_value: 'parking_entrance', osm_type: 'N', osm_id: 4 }),
      ],
    });
    expect(places.map((p) => p.name)).toEqual(['Kampung Sungai Lembu', 'Mall Central Parking Entrance B', 'Random Cafe', 'Another Shop']);
  });

  it('de-duplicates by osm id and respects the limit', () => {
    const places = parsePhotonResponse(
      { features: [feature({ name: 'A', osm_type: 'N', osm_id: 1 }), feature({ name: 'A again', osm_type: 'N', osm_id: 1 }), feature({ name: 'B', osm_type: 'N', osm_id: 2 })] },
      2,
    );
    expect(places.map((p) => p.name)).toEqual(['A', 'B']);
  });

  it('throws on a response with no feature list', () => {
    expect(() => parsePhotonResponse({ hello: 'world' })).toThrow(PlaceSearchError);
    expect(() => parsePhotonResponse(null)).toThrow(PlaceSearchError);
  });
});

describe('searchPlaces', () => {
  it('uses mock results and never touches the network for a .invalid URL', async () => {
    const fetchMock = jest.fn() as unknown as typeof fetch;
    const result = await searchPlaces({ query: 'klcc', baseUrl: DEMO_PHOTON_BASE_URL, fetch: fetchMock });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.mock).toBe(true);
    expect(result.places.length).toBeGreaterThan(0);
  });

  it('skips the request for queries shorter than two characters', async () => {
    const fetchMock = jest.fn() as unknown as typeof fetch;
    expect((await searchPlaces({ query: ' k ', baseUrl: LIVE, fetch: fetchMock })).places).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('calls <base>/api with a Malaysia bbox, focus point and encoded query', async () => {
    const fetchMock = jest.fn(async () => okResponse({ features: [feature({ name: 'Kampung Baru', osm_type: 'N', osm_id: 9 })] })) as unknown as jest.MockedFunction<typeof fetch>;
    const result = await searchPlaces({ query: 'kampung baru & co', baseUrl: `${LIVE}/`, focus: { lng: 101.7, lat: 3.15 }, fetch: fetchMock });

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe(`${LIVE}/api`);
    expect(url.searchParams.get('q')).toBe('kampung baru & co');
    expect(url.searchParams.get('bbox')).toBe(MALAYSIA_BBOX);
    expect(url.searchParams.get('lat')).toBe('3.15');
    expect(url.searchParams.get('lon')).toBe('101.7');
    expect(result.mock).toBe(false);
    expect(result.places[0].name).toBe('Kampung Baru');
  });

  it('always appends the Malaysia bias lat=3.0733&lon=101.6067 when no focus is given', async () => {
    const fetchMock = jest.fn(async () => okResponse({ features: [] })) as unknown as jest.MockedFunction<typeof fetch>;
    await searchPlaces({ query: 'sunway', baseUrl: 'https://photon.komoot.io', fetch: fetchMock });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url.startsWith('https://photon.komoot.io/api?')).toBe(true);
    expect(url).toContain('lat=3.0733');
    expect(url).toContain('lon=101.6067');
    expect(PHOTON_BIAS).toEqual({ lat: 3.0733, lng: 101.6067 });
  });

  it('always appends the Malaysia bias lat=3.0733&lon=101.6067 when no focus is given', async () => {
    const fetchMock = jest.fn(async () => okResponse({ features: [] })) as unknown as jest.MockedFunction<typeof fetch>;
    await searchPlaces({ query: 'sunway', baseUrl: 'https://photon.komoot.io', fetch: fetchMock });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url.startsWith('https://photon.komoot.io/api?')).toBe(true);
    expect(url).toContain('lat=3.0733');
    expect(url).toContain('lon=101.6067');
    expect(PHOTON_BIAS).toEqual({ lat: 3.0733, lng: 101.6067 });
  });

  it('wraps HTTP and network failures in PlaceSearchError', async () => {
    const http = jest.fn(async () => ({ ok: false, status: 502 }) as Response) as unknown as typeof fetch;
    await expect(searchPlaces({ query: 'klcc', baseUrl: LIVE, fetch: http })).rejects.toBeInstanceOf(PlaceSearchError);

    const net = jest.fn(async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;
    await expect(searchPlaces({ query: 'klcc', baseUrl: LIVE, fetch: net })).rejects.toBeInstanceOf(PlaceSearchError);
  });
});
