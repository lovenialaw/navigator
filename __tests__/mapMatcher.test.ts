import fixture from './fixtures/valhalla-klcc-seremban.json';
import { normalizeValhalla } from '../src/routing/valhallaClient';
import { valhallaResponseSchema } from '../src/schemas/valhallaSchema';
import { bearingDeg, haversineM, type LngLat } from '../src/utils/geo';
import {
  MATCH_CONFIG,
  advanceAlong,
  buildRouteGeometry,
  initialMatchState,
  locateAlong,
  matchFix,
  stepIndexAtSegment,
  type GpsFix,
  type MatchState,
  type RouteGeometry,
} from '../src/utils/mapMatcher';

const LAT0 = 3.1;
const LNG0 = 101.6;
const M_PER_DEG_LAT = 111_195;
const mPerDegLng = (lat: number) => 111_195 * Math.cos((lat * Math.PI) / 180);

/** Point offset by metres east / north. */
function offset(p: LngLat, eastM: number, northM: number): LngLat {
  return [p[0] + eastM / mPerDegLng(p[1]), p[1] + northM / M_PER_DEG_LAT];
}

function fix(p: LngLat, extra: Partial<GpsFix> = {}): GpsFix {
  return { lng: p[0], lat: p[1], headingDeg: 90, speedMps: 20, timestampMs: 0, ...extra };
}

/** Straight eastbound road, 41 points ~106 m apart, steps of 10 points. */
function eastRoad(): RouteGeometry {
  const shape: LngLat[] = Array.from({ length: 41 }, (_, i) => [LNG0 + i * 0.001, LAT0] as const);
  return buildRouteGeometry(shape, [
    { beginShapeIndex: 0, endShapeIndex: 10 },
    { beginShapeIndex: 10, endShapeIndex: 20 },
    { beginShapeIndex: 20, endShapeIndex: 30 },
    { beginShapeIndex: 30, endShapeIndex: 40 },
    { beginShapeIndex: 40, endShapeIndex: 40 },
  ]);
}

describe('buildRouteGeometry / locateAlong', () => {
  it('accumulates length and bearings', () => {
    const g = eastRoad();
    expect(g.totalM).toBeCloseTo(40 * 0.001 * mPerDegLng(LAT0), -1);
    expect(g.segmentBearing[0]).toBeCloseTo(90, 1);
    expect(stepIndexAtSegment(g, 0)).toBe(0);
    expect(stepIndexAtSegment(g, 9)).toBe(0);
    expect(stepIndexAtSegment(g, 10)).toBe(1);
    expect(stepIndexAtSegment(g, 39)).toBe(3);
  });

  it('finds points along the route and clamps to its ends', () => {
    const g = eastRoad();
    const mid = locateAlong(g, g.totalM / 2);
    expect(mid.point[0]).toBeCloseTo(LNG0 + 0.02, 5);
    expect(locateAlong(g, -50).alongM).toBe(0);
    expect(locateAlong(g, g.totalM + 500).alongM).toBeCloseTo(g.totalM, 3);
  });
});

describe('matchFix: perpendicular snapping', () => {
  it('snaps a noisy fix onto the route', () => {
    const g = eastRoad();
    const onRoad: LngLat = [LNG0 + 0.0055, LAT0];
    const result = matchFix(g, initialMatchState(g), fix(offset(onRoad, 0, 15)));
    expect(result.status).toBe('on-route');
    expect(result.position[1]).toBeCloseTo(LAT0, 6);
    expect(result.position[0]).toBeCloseTo(onRoad[0], 5);
    expect(result.deviationM).toBeCloseTo(15, 0);
    expect(result.bearingDeg).toBeCloseTo(90, 1);
    expect(result.state.alongM).toBeCloseTo(haversineM([LNG0, LAT0], onRoad), 0);
  });
});

describe('matchFix: monotonic progress', () => {
  it('never moves the puck backwards on GPS jitter', () => {
    const g = eastRoad();
    let state = initialMatchState(g);
    const a = matchFix(g, state, fix([LNG0 + 0.01, LAT0]));
    state = a.state;
    const b = matchFix(g, state, fix([LNG0 + 0.0095, LAT0]));
    expect(b.state.alongM).toBeGreaterThanOrEqual(a.state.alongM);
    expect(b.state.segmentIndex).toBeGreaterThanOrEqual(a.state.segmentIndex);
    expect(b.position[0]).toBeGreaterThanOrEqual(a.position[0] - 1e-9);
  });

  it('does not search behind the current segment', () => {
    const g = eastRoad();
    const ahead = matchFix(g, initialMatchState(g), fix([LNG0 + 0.03, LAT0]));
    const behind = matchFix(g, ahead.state, fix([LNG0 + 0.002, LAT0]));
    expect(behind.status).not.toBe('on-route');
    expect(behind.state.segmentIndex).toBe(ahead.state.segmentIndex);
  });
});

describe('matchFix: flyover and parallel carriageway (bearing gate)', () => {
  // Out and back: east along lat 3.1000, then west along lat 3.10027 (30 m north).
  const eastLeg: LngLat[] = Array.from({ length: 21 }, (_, i) => [LNG0 + i * 0.001, LAT0] as const);
  const northLat = LAT0 + 30 / M_PER_DEG_LAT;
  const westLeg: LngLat[] = Array.from({ length: 21 }, (_, i) => [LNG0 + (20 - i) * 0.001, northLat] as const);
  const shape = [...eastLeg, ...westLeg];
  const g = buildRouteGeometry(shape, [
    { beginShapeIndex: 0, endShapeIndex: 20 },
    { beginShapeIndex: 20, endShapeIndex: 40 },
    { beginShapeIndex: 40, endShapeIndex: 40 },
  ]);
  const midLat = LAT0 + 15 / M_PER_DEG_LAT; // 15 m from each carriageway
  const mid: LngLat = [LNG0 + 0.0105, midLat];

  it('driving east between the two roads snaps to the eastbound road', () => {
    const result = matchFix(g, initialMatchState(g), fix(mid, { headingDeg: 90 }));
    expect(result.status).toBe('on-route');
    expect(result.position[1]).toBeCloseTo(LAT0, 6);
    expect(result.bearingDeg).toBeCloseTo(90, 1);
  });

  it('driving west between the two roads snaps to the westbound road', () => {
    // The driver is already on the westbound leg.
    const state = initialMatchState(g, g.cumulativeM[22]);
    const result = matchFix(g, state, fix(mid, { headingDeg: 270 }));
    expect(result.status).toBe('on-route');
    expect(result.position[1]).toBeCloseTo(northLat, 6);
    expect(result.bearingDeg).toBeCloseTo(270, 1);
  });

  it('rejects segments more than 35 degrees off the travel bearing', () => {
    const state = initialMatchState(g, g.cumulativeM[22]);
    // Heading east while on the westbound leg: 180 degrees off, so not snapped.
    const result = matchFix(g, state, fix(mid, { headingDeg: 90 }));
    expect(result.status).toBe('unaligned');
    expect(result.position).toEqual(mid);
  });

  it('allows up to 35 degrees and rejects beyond', () => {
    const g2 = eastRoad();
    const p: LngLat = [LNG0 + 0.0105, LAT0 + 10 / M_PER_DEG_LAT];
    expect(matchFix(g2, initialMatchState(g2), fix(p, { headingDeg: 90 + 34 })).status).toBe('on-route');
    expect(matchFix(g2, initialMatchState(g2), fix(p, { headingDeg: 90 + 36 })).status).toBe('unaligned');
    expect(matchFix(g2, initialMatchState(g2), fix(p, { headingDeg: 90 - 34 })).status).toBe('on-route');
    expect(MATCH_CONFIG.maxBearingDiffDeg).toBe(35);
  });

  it('works across the 0/360 wrap', () => {
    const north: LngLat[] = Array.from({ length: 11 }, (_, i) => [LNG0, LAT0 + i * 0.001] as const);
    const gn = buildRouteGeometry(north, [{ beginShapeIndex: 0, endShapeIndex: 10 }]);
    const p: LngLat = [LNG0 + 5 / mPerDegLng(LAT0), LAT0 + 0.004];
    expect(matchFix(gn, initialMatchState(gn), fix(p, { headingDeg: 350 })).status).toBe('on-route');
    expect(matchFix(gn, initialMatchState(gn), fix(p, { headingDeg: 20 })).status).toBe('on-route');
    expect(matchFix(gn, initialMatchState(gn), fix(p, { headingDeg: 40 })).status).toBe('unaligned');
  });

  it('ignores a meaningless heading at walking speed or when unavailable', () => {
    const g2 = eastRoad();
    const p: LngLat = [LNG0 + 0.0105, LAT0 + 10 / M_PER_DEG_LAT];
    expect(matchFix(g2, initialMatchState(g2), fix(p, { headingDeg: 270, speedMps: 1 })).status).toBe('on-route');
    expect(matchFix(g2, initialMatchState(g2), fix(p, { headingDeg: null })).status).toBe('on-route');
    expect(matchFix(g2, initialMatchState(g2), fix(p, { headingDeg: -1 })).status).toBe('on-route');
  });
});

describe('matchFix: off-route detection (60 m, 5 s)', () => {
  const g = eastRoad();
  const farFix = (t: number): GpsFix => fix(offset([LNG0 + 0.01, LAT0], 0, 100), { timestampMs: t });

  it('asks for a re-route only after more than 5 s beyond 60 m', () => {
    let state: MatchState = initialMatchState(g);
    const first = matchFix(g, state, farFix(10_000));
    expect(first.status).toBe('off-route');
    expect(first.deviationM).toBeCloseTo(100, 0);
    state = first.state;
    expect(state.offRouteSinceMs).toBe(10_000);

    const at4 = matchFix(g, state, farFix(14_900));
    expect(at4.status).toBe('off-route');
    const at5 = matchFix(g, at4.state, farFix(15_000));
    expect(at5.status).toBe('off-route'); // exactly 5 s is not "more than 5 s"
    const at6 = matchFix(g, at5.state, farFix(15_100));
    expect(at6.status).toBe('reroute');
  });

  it('shows the raw GPS position while off-route', () => {
    const f = farFix(0);
    const result = matchFix(g, initialMatchState(g), f);
    expect(result.position).toEqual([f.lng, f.lat]);
    expect(result.bearingDeg).toBeNull();
  });

  it('resets the clock when the driver rejoins the route', () => {
    let state = initialMatchState(g);
    state = matchFix(g, state, farFix(0)).state;
    expect(state.offRouteSinceMs).toBe(0);
    const back = matchFix(g, state, fix([LNG0 + 0.011, LAT0], { timestampMs: 3000 }));
    expect(back.status).toBe('on-route');
    expect(back.state.offRouteSinceMs).toBeNull();
    // A later excursion starts a fresh 5 s timer.
    const again = matchFix(g, back.state, farFix(20_000));
    expect(again.status).toBe('off-route');
    expect(again.state.offRouteSinceMs).toBe(20_000);
  });

  it('does not start the clock for a fix within 60 m that merely points the wrong way', () => {
    const wrongWay = fix(offset([LNG0 + 0.01, LAT0], 0, 30), { headingDeg: 270, timestampMs: 5_000 });
    const result = matchFix(g, initialMatchState(g), wrongWay);
    expect(result.status).toBe('unaligned');
    expect(result.state.offRouteSinceMs).toBeNull();
  });

  it('treats 59 m as on route and 61 m as off route', () => {
    const near = matchFix(g, initialMatchState(g), fix(offset([LNG0 + 0.01, LAT0], 0, 59)));
    const far = matchFix(g, initialMatchState(g), fix(offset([LNG0 + 0.01, LAT0], 0, 61)));
    expect(near.status).toBe('on-route');
    expect(far.status).toBe('off-route');
  });
});

describe('matchFix: GPS gaps', () => {
  it('re-acquires far ahead on the route after a tunnel (outside the maneuver window)', () => {
    const g = eastRoad();
    const result = matchFix(g, initialMatchState(g), fix([LNG0 + 0.035, LAT0]));
    expect(result.status).toBe('on-route');
    // The fix sits exactly on shape point 35: the end of segment 34 or the start of 35.
    expect(result.state.segmentIndex).toBeGreaterThanOrEqual(34);
    expect(result.state.alongM).toBeCloseTo(g.cumulativeM[35], 0);
    expect(stepIndexAtSegment(g, result.state.segmentIndex)).toBe(3);
  });

  it('dead-reckons along the cached route while there is no GPS', () => {
    const g = eastRoad();
    const start = initialMatchState(g, 1000);
    const next = advanceAlong(g, start, 500);
    expect(next.alongM).toBeCloseTo(1500, 3);
    expect(next.segmentIndex).toBeGreaterThan(start.segmentIndex);
    expect(advanceAlong(g, next, 1e9).alongM).toBeCloseTo(g.totalM, 3);
    expect(advanceAlong(g, next, -5)).toBe(next);
    expect(advanceAlong(g, next, 0)).toBe(next);
  });
});

describe('matchFix: degenerate routes', () => {
  it('does not crash on a one-point route', () => {
    const g = buildRouteGeometry([[LNG0, LAT0]], []);
    const result = matchFix(g, initialMatchState(g), fix([LNG0, LAT0]));
    expect(result.status).toBe('off-route');
  });
});

describe('drive the real KLCC to Seremban route with GPS noise', () => {
  const raw = normalizeValhalla(valhallaResponseSchema.parse(fixture));
  const g = buildRouteGeometry(raw.shape, raw.steps);

  it('stays matched, monotonic, and reaches the end', () => {
    let state = initialMatchState(g);
    let timestamp = 0;
    let lastAlong = 0;
    let lastStep = 0;
    let offRouteFixes = 0;
    let fixes = 0;

    for (let d = 0; d < g.totalM; d += 30) {
      const truth = locateAlong(g, d);
      const heading = g.segmentBearing[truth.segmentIndex];
      // Deterministic +-8 m lateral GPS noise, perpendicular to the road.
      const noise = Math.sin(d / 37) * 8;
      const rad = ((heading + 90) * Math.PI) / 180;
      const noisy = offset(truth.point, Math.sin(rad) * noise, Math.cos(rad) * noise);

      timestamp += 1500;
      const result = matchFix(g, state, fix(noisy, { headingDeg: Number.isNaN(heading) ? null : heading, speedMps: 20, timestampMs: timestamp }));
      fixes += 1;
      if (result.status !== 'on-route') offRouteFixes += 1;
      state = result.state;

      expect(state.alongM).toBeGreaterThanOrEqual(lastAlong);
      const step = stepIndexAtSegment(g, state.segmentIndex);
      expect(step).toBeGreaterThanOrEqual(lastStep);
      lastAlong = state.alongM;
      lastStep = step;
    }

    expect(fixes).toBeGreaterThan(2000);
    expect(offRouteFixes).toBe(0);
    expect(lastAlong).toBeGreaterThan(g.totalM - 60);
    expect(lastStep).toBe(raw.steps.length - 2);
    // Matched progress tracks the true distance driven, so the puck never skipped a level.
    expect(Math.abs(lastAlong - (Math.floor((g.totalM - 1) / 30) * 30))).toBeLessThan(25);
  });

  it('uses the maneuver shape indices from the real response', () => {
    expect(g.steps).toHaveLength(20);
    expect(bearingDeg(raw.shape[0], raw.shape[9])).toBeGreaterThan(280);
  });
});
