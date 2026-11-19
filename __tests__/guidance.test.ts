import fixture from './fixtures/valhalla-klcc-seremban.json';
import { buildHudModel, computeProgress, ARRIVE_RADIUS_M, type GuidanceProgress } from '../src/navigation/guidance';
import { maneuverIcon } from '../src/navigation/maneuverIcon';
import { ROAD_SIGN_COLORS, classifyRoad, isRoadRef } from '../src/navigation/roadSign';
import { formatCountdown } from '../src/routing/format';
import { finalizeRoute } from '../src/routing/rawRoute';
import { planRoutes, normalizeValhalla } from '../src/routing/valhallaClient';
import type { PlannedRoute } from '../src/routing/routeTypes';
import { DEMO_VALHALLA_BASE_URL } from '../src/config/tujuConfig';
import { valhallaResponseSchema } from '../src/schemas/valhallaSchema';
import { buildRouteGeometry, initialMatchState } from '../src/utils/mapMatcher';

const place = { id: 'seremban', name: 'Seremban', subtitle: 'Negeri Sembilan', lng: 101.937, lat: 2.7266 };

function realRoute(): PlannedRoute {
  const raw = normalizeValhalla(valhallaResponseSchema.parse(fixture));
  return finalizeRoute(raw, {
    profile: 'fastest',
    origin: { lng: 101.7116, lat: 3.1579 },
    destination: place,
    mock: false,
    now: 1_700_000_000_000,
  });
}

describe('road sign classification', () => {
  it('is green for Malaysian expressways, by name or ref', () => {
    for (const name of ['PLUS', 'LDP', 'KESAS', 'MEX', 'DUKE', 'AKLEH', 'E12', 'E2', 'AH2', 'Lebuhraya Utara–Selatan', 'Lebuhraya Bertingkat Ampang - Kuala Lumpur', 'Terowong Smart', 'Lebuhraya Kuala Lumpur–Seremban', 'ELITE', 'NKVE']) {
      expect(classifyRoad([name])).toBe('expressway');
    }
  });

  it('is blue for federal and municipal roads', () => {
    for (const name of ['Jalan Tun Razak', 'Jalan Sultan Ismail', 'Jalan Dato\' Bandar Tunggal', '1', '241', 'Lorong Kuda', 'FT2']) {
      expect(classifyRoad([name])).toBe('federal');
    }
  });

  it('treats Lebuhraya Persekutuan (Federal Highway) as federal, not expressway', () => {
    expect(classifyRoad(['Lebuhraya Persekutuan'])).toBe('federal');
    expect(classifyRoad(['Federal Highway'])).toBe('federal');
  });

  it('turns green whenever a sign carries an expressway exit number', () => {
    expect(classifyRoad([], '1107')).toBe('expressway');
    expect(classifyRoad(['Jalan Sultan Ismail'], '1201B')).toBe('expressway');
    expect(classifyRoad(['Jalan Sultan Ismail'], '  ')).toBe('federal');
  });

  it('uses the specified colours', () => {
    expect(ROAD_SIGN_COLORS).toEqual({ expressway: '#006B3F', federal: '#003DA5' });
  });

  it('tells route refs from street names', () => {
    expect(['E12', '241', 'AH2', '1', 'FT2'].every(isRoadRef)).toBe(true);
    expect(['Jalan Ampang', 'Lorong Kuda', 'Terowong Smart'].some(isRoadRef)).toBe(false);
  });
});

describe('maneuver icons and countdown', () => {
  it('maps Valhalla types to arrows', () => {
    expect(maneuverIcon(10)).toEqual({ glyph: '↑', rotationDeg: 90 });
    expect(maneuverIcon(15)).toEqual({ glyph: '↑', rotationDeg: -90 });
    expect(maneuverIcon(9).rotationDeg).toBe(45);
    expect(maneuverIcon(16).rotationDeg).toBe(-45);
    expect(maneuverIcon(8)).toEqual({ glyph: '↑', rotationDeg: 0 });
    expect(maneuverIcon(4).glyph).toBe('🏁');
    expect(maneuverIcon(999)).toEqual({ glyph: '↑', rotationDeg: 0 });
  });

  it('rounds the countdown for a quick glance', () => {
    expect(formatCountdown(4)).toBe('10 m');
    expect(formatCountdown(47)).toBe('50 m');
    expect(formatCountdown(320)).toBe('300 m');
    expect(formatCountdown(980)).toBe('1000 m');
    expect(formatCountdown(1240)).toBe('1.2 km');
    expect(formatCountdown(Number.NaN)).toBe('10 m');
  });
});

describe('computeProgress on the real route', () => {
  const route = realRoute();
  const geometry = buildRouteGeometry(route.shape, route.steps);

  it('starts at step 0 with the whole trip remaining', () => {
    const p = computeProgress(route, geometry, initialMatchState(geometry));
    expect(p.stepIndex).toBe(0);
    expect(p.nextStepIndex).toBe(1);
    expect(p.arrived).toBe(false);
    expect(p.remainingDistanceM).toBeCloseTo(route.distanceM, 0);
    expect(p.remainingDurationSec).toBeCloseTo(route.durationSec, -1);
    expect(p.distanceToNextM).toBeGreaterThan(300);
    expect(p.distanceToNextM).toBeLessThan(500);
  });

  it('counts down as the vehicle advances', () => {
    let previous = computeProgress(route, geometry, initialMatchState(geometry));
    for (const fraction of [0.1, 0.3, 0.6, 0.9]) {
      const p = computeProgress(route, geometry, initialMatchState(geometry, geometry.totalM * fraction));
      expect(p.remainingDistanceM).toBeLessThan(previous.remainingDistanceM);
      expect(p.remainingDurationSec).toBeLessThan(previous.remainingDurationSec);
      expect(p.stepIndex).toBeGreaterThanOrEqual(previous.stepIndex);
      previous = p;
    }
  });

  it('reports arrival within 30 m of the end', () => {
    expect(ARRIVE_RADIUS_M).toBe(30);
    const near = computeProgress(route, geometry, initialMatchState(geometry, geometry.totalM - 20));
    expect(near.arrived).toBe(true);
    const notYet = computeProgress(route, geometry, initialMatchState(geometry, geometry.totalM - 80));
    expect(notYet.arrived).toBe(false);
  });

  it('distance to the next maneuver is measured to its begin_shape_index', () => {
    const second = route.steps[1];
    const state = initialMatchState(geometry, geometry.cumulativeM[second.beginShapeIndex] - 123);
    const p = computeProgress(route, geometry, state);
    expect(p.stepIndex).toBe(0);
    expect(p.distanceToNextM).toBeCloseTo(123, 0);
  });
});

describe('upcoming toll cost from malaysiaTolls.json', () => {
  it('drops as each toll plaza is passed', async () => {
    const { routes } = await planRoutes({
      origin: { lng: 101.7116, lat: 3.1579 },
      destination: { id: 'sunway', name: 'Sunway Pyramid', subtitle: '', lng: 101.6071, lat: 3.0728 },
      baseUrl: DEMO_VALHALLA_BASE_URL,
    });
    const route = routes.find((r) => r.profile === 'fastest') as PlannedRoute; // LDP corridor
    const geometry = buildRouteGeometry(route.shape, route.steps);
    const charges = route.toll.charges;
    expect(charges.length).toBeGreaterThan(1);

    const total = route.toll.totalRinggit;
    const atStart = computeProgress(route, geometry, initialMatchState(geometry));
    expect(atStart.tollAheadRinggit).toBeCloseTo(total, 2);

    const afterFirst = computeProgress(route, geometry, initialMatchState(geometry, charges[0].alongM + 5));
    expect(afterFirst.tollAheadRinggit).toBeCloseTo(total - charges[0].rateRinggit, 2);

    const afterAll = computeProgress(route, geometry, initialMatchState(geometry, charges[charges.length - 1].alongM + 5));
    expect(afterAll.tollAheadRinggit).toBe(0);
  });
});

describe('buildHudModel', () => {
  const route = realRoute();
  const base: GuidanceProgress = {
    stepIndex: 0,
    nextStepIndex: 1,
    distanceToNextM: 320,
    remainingDistanceM: 69_000,
    remainingDurationSec: 4000,
    tollAheadRinggit: 0,
    arrived: false,
  };
  const now = new Date(2026, 10, 19, 21, 0, 0).getTime();

  it('shows a green banner with the ramp badge for the E12 ramp', () => {
    const hud = buildHudModel(route, base, now);
    expect(hud.banner.kind).toBe('expressway');
    expect(hud.banner.badges).toEqual(['E12']);
    expect(hud.banner.primary).toBe('Lebuhraya Bertingkat Ampang - Kuala Lumpur');
    expect(hud.banner.distanceText).toBe('300 m');
    expect(hud.banner.exitLabel).toBeNull();
    expect(hud.lanes).toEqual([]);
  });

  it('shows EXIT 1201B and the street it leads to', () => {
    const hud = buildHudModel(route, { ...base, stepIndex: 1, nextStepIndex: 2 }, now);
    expect(hud.banner.kind).toBe('expressway');
    expect(hud.banner.exitLabel).toBe('EXIT 1201B');
    expect(hud.banner.primary).toBe('Jalan Sultan Ismail, Jalan Bukit Bintang, Jalan Tun Razak');
  });

  it('is blue for a municipal street entered from a municipal street', () => {
    const idx = route.steps.findIndex((s) => s.streetNames.includes('Jalan Dr. Krishnan'));
    const hud = buildHudModel(route, { ...base, stepIndex: idx - 1, nextStepIndex: idx }, now);
    expect(hud.banner.kind).toBe('federal');
    expect(hud.banner.primary).toBe('Jalan Dr. Krishnan');
    expect(hud.banner.exitLabel).toBeNull();
  });

  it('formats the bottom bar: ETA, remaining distance, tolls', () => {
    const hud = buildHudModel(route, { ...base, tollAheadRinggit: 8.4 }, now);
    expect(hud.bottom.remainingDistanceText).toBe('69.0 km');
    expect(hud.bottom.remainingDurationText).toBe('1 h 07 min');
    expect(hud.bottom.arrivalText).toBe('10:07 PM');
    expect(hud.bottom.tollText).toBe('RM 8.40 est. tolls ahead');
    expect(hud.bottom.hasTollAhead).toBe(true);
    expect(buildHudModel(route, base, now).bottom.tollText).toBe('No tolls ahead');
  });

  it('switches to an arrival banner and clears lanes', () => {
    const hud = buildHudModel(route, { ...base, arrived: true, remainingDistanceM: 10, remainingDurationSec: 5 }, now);
    expect(hud.arrived).toBe(true);
    expect(hud.banner.primary).toBe('You have arrived at Seremban');
    expect(hud.lanes).toEqual([]);
  });

  it('passes lanes through from the upcoming maneuver', () => {
    const withLanes: PlannedRoute = {
      ...route,
      steps: route.steps.map((s, i) =>
        i === 1 ? { ...s, lanes: [{ directions: ['through'], active: true }, { directions: ['right'], active: false }] } : s,
      ),
    };
    const hud = buildHudModel(withLanes, base, now);
    expect(hud.lanes).toEqual([
      { directions: ['through'], active: true },
      { directions: ['right'], active: false },
    ]);
  });
});
