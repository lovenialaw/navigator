import { decodePolyline, encodePolyline } from '../src/routing/polyline';

describe('polyline', () => {
  it('decodes the canonical precision-5 example into [lng, lat]', () => {
    const points = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5);
    expect(points).toEqual([
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ]);
  });

  it('round-trips precision-6 Malaysian coordinates', () => {
    const route: [number, number][] = [
      [101.711623, 3.157912],
      [101.606412, 3.073344],
      [101.666701, 2.931702],
    ];
    const decoded = decodePolyline(encodePolyline(route));
    decoded.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(route[i][0], 6);
      expect(p[1]).toBeCloseTo(route[i][1], 6);
    });
  });

  it('returns an empty list for an empty string', () => {
    expect(decodePolyline('')).toEqual([]);
  });

  it('throws on truncated or invalid input instead of returning garbage', () => {
    expect(() => decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq')).toThrow();
    expect(() => decodePolyline('\u0001\u0002')).toThrow();
    expect(() => decodePolyline('~~~~~~~~~~~~~~~~~~~~~~~~')).toThrow();
  });
});
