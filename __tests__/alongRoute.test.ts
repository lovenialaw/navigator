import {
  alertsAhead,
  corridorCovers,
  distanceToAlertM,
  locateAlerts,
  locatePois,
  nextAhead,
  projectOntoRoute,
} from '../src/poi/alongRoute';
import type { Alert } from '../src/alerts/alertTypes';
import type { Poi } from '../src/poi/poiTypes';
import { buildSampleAlerts, buildSamplePois } from '../src/poi/samplePois';
import { buildRouteGeometry } from '../src/utils/mapMatcher';
import type { LngLat } from '../src/utils/geo';

// A straight east-west road at 3.0 N, 101.00 E to 101.20 E (about 22 km), a point per 0.01 degrees.
const shape: LngLat[] = Array.from({ length: 21 }, (_, i) => [101 + i * 0.01, 3] as const);
const geometry = buildRouteGeometry(shape, []);

function poi(id: string, kind: Poi['kind'], lng: number, lat: number): Poi {
  return { id, kind, name: id, lng, lat, sample: false };
}

function alert(id: string, lng: number, lat: number, radiusM: number): Alert {
  return { id, kind: 'flood', title: id, severity: 'warning', source: 'JPS', lng, lat, radiusM };
}

describe('projectOntoRoute', () => {
  it('gives distance along the road and offset from it', () => {
    const hit = projectOntoRoute(geometry, [101.1, 3.002]);
    expect(hit).not.toBeNull();
    expect(hit!.alongM).toBeGreaterThan(11_000);
    expect(hit!.alongM).toBeLessThan(11_200);
    expect(hit!.offsetM).toBeGreaterThan(200);
    expect(hit!.offsetM).toBeLessThan(245);
  });

  it('returns null when the point is too far from the road', () => {
    expect(projectOntoRoute(geometry, [101.1, 3.1], 1000)).toBeNull();
    expect(projectOntoRoute(geometry, [101.1, 3.1])).not.toBeNull();
  });

  it('clamps a point past the end to the end of the road', () => {
    const hit = projectOntoRoute(geometry, [101.3, 3]);
    expect(hit!.alongM).toBeCloseTo(geometry.totalM, 0);
  });
});

describe('locatePois', () => {
  it('sorts by distance along the route and drops far-off places', () => {
    const located = locatePois(geometry, [
      poi('late', 'fuel', 101.15, 3.001),
      poi('early', 'rnr', 101.05, 3.001),
      poi('far-rnr', 'rnr', 101.1, 3.009), // ~1 km off: R&Rs must be roadside
      poi('far-fuel', 'fuel', 101.1, 3.009), // ~1 km off: a fuel stop in a town off an exit is fine
      poi('lost', 'fuel', 101.1, 3.05),
    ]);
    expect(located.map((p) => p.id)).toEqual(['early', 'far-fuel', 'late']);
    expect(located[0].alongM).toBeLessThan(located[1].alongM);
    // 0.05 degrees of longitude at 3 N is about 5.55 km.
    expect(located[0].alongM).toBeGreaterThan(5500);
    expect(located[0].alongM).toBeLessThan(5600);
  });
});

describe('nextAhead', () => {
  const items = [1000, 2000, 3000, 4000, 5000].map((alongM) => ({ alongM }));

  it('returns only what is still ahead, nearest first, capped at three', () => {
    expect(nextAhead(items, 1500).map((i) => i.alongM)).toEqual([2000, 3000, 4000]);
    expect(nextAhead(items, 4500).map((i) => i.alongM)).toEqual([5000]);
    expect(nextAhead(items, 9999)).toEqual([]);
  });

  it('does not list a stop the car is exactly at', () => {
    expect(nextAhead(items, 2000).map((i) => i.alongM)).toEqual([3000, 4000, 5000]);
  });
});

describe('alerts on the route', () => {
  it('computes where the route enters and leaves the alert area', () => {
    // Centre 1 km off the road, 2 km radius: the road crosses a chord of 2 x sqrt(4 - 1) = 3.46 km.
    const [located] = locateAlerts(geometry, [alert('a', 101.1, 3.009, 2000)]);
    expect(located.exitM - located.enterM).toBeGreaterThan(3300);
    expect(located.exitM - located.enterM).toBeLessThan(3600);
    expect((located.enterM + located.exitM) / 2).toBeGreaterThan(11_000);
    expect((located.enterM + located.exitM) / 2).toBeLessThan(11_250);
  });

  it('ignores alerts whose area the road does not touch', () => {
    expect(locateAlerts(geometry, [alert('far', 101.1, 3.05, 2000)])).toEqual([]);
  });

  it('lists upcoming alerts, keeps the one being driven through, drops those behind', () => {
    const located = locateAlerts(geometry, [
      alert('behind', 101.02, 3, 500),
      alert('inside', 101.1, 3, 1500),
      alert('ahead', 101.18, 3, 500),
    ]);
    const along = 11_104;
    const ahead = alertsAhead(located, along);
    expect(ahead.map((a) => a.id)).toEqual(['inside', 'ahead']);
    expect(distanceToAlertM(ahead[0], along)).toBe(0);
    expect(distanceToAlertM(ahead[1], along)).toBeGreaterThan(6000);
  });
});

describe('corridorCovers', () => {
  it('accepts a new route on the same road and rejects one that left it', () => {
    const sameRoad = shape.slice(5, 15);
    const detour: LngLat[] = [shape[5], [101.1, 3.05], shape[15]];
    expect(corridorCovers(geometry, sameRoad, 400)).toBe(true);
    expect(corridorCovers(geometry, detour, 400)).toBe(false);
  });
});

describe('demo (sample) data', () => {
  it('places sample stops on the route itself, clearly labelled', () => {
    const pois = buildSamplePois(shape);
    expect(pois.length).toBeGreaterThanOrEqual(3);
    expect(pois.every((p) => p.sample && p.name.startsWith('Sample'))).toBe(true);
    expect(new Set(pois.map((p) => p.kind)).size).toBe(3);
    const located = locatePois(geometry, pois);
    expect(located).toHaveLength(pois.length);
    expect(Math.max(...located.map((p) => p.offsetM))).toBeLessThan(5);
  });

  it('places sample alerts the route actually crosses', () => {
    const alerts = buildSampleAlerts(shape, 1_000_000);
    expect(locateAlerts(geometry, alerts)).toHaveLength(alerts.length);
    expect(alerts.every((a) => (a.expiresAt ?? 0) > 1_000_000)).toBe(true);
  });

  it('makes nothing for a route too short to hold anything', () => {
    expect(buildSamplePois([[101, 3], [101.001, 3]])).toEqual([]);
    expect(buildSampleAlerts([[101, 3], [101.001, 3]], 0)).toEqual([]);
  });
});
