/**
 * Built-in sample routes, used ONLY while the Valhalla URL is a `.invalid` placeholder.
 * They exist so the comparison sheet and the toll calculator can be tried on a phone
 * before a routing server exists. Nothing here is real navigation data.
 *
 * Inside the Klang Valley the three profiles follow fixed corridors built from the
 * real plaza coordinates in `malaysiaTolls.json`:
 *   fastest      -> LDP   (4 plazas)
 *   trunk_roads  -> MEX   (3 plazas)
 *   avoid_tolls  -> a toll-free surface-road corridor
 * Elsewhere in Malaysia the three are straight-ish lines with different detours. They
 * are priced like any real route, so a line that happens to cross a known plaza (for
 * example one leaving KL past DUKE) will show that plaza's toll.
 */
import { bundledTollData } from '../utils/tollCalculator';
import { haversineM, pathLengthM, type LngLat } from '../utils/geo';
import type { RawRoute } from './rawRoute';
import type { Place, RouteProfile, RouteStep, RouteWarning } from './routeTypes';

const KLANG_VALLEY: [number, number, number, number] = [101.2, 2.6, 101.95, 3.5];

interface Corridor {
  road: string;
  speedKph: number;
  waypoints: LngLat[];
  warnings: RouteWarning[];
}

function plazaPoint(code: string): LngLat {
  for (const highway of bundledTollData.highways) {
    const plaza = highway.plazas.find((p) => p.plazaCode === code);
    if (plaza) return [plaza.lng, plaza.lat];
  }
  throw new Error(`mock corridor references unknown plaza ${code}`);
}

const KV_CORRIDORS: Record<RouteProfile, Corridor> = {
  fastest: {
    road: 'Lebuhraya Damansara-Puchong (LDP)',
    speedKph: 70,
    waypoints: ['LDP-PEN', 'LDP-PJS', 'LDP-PCB', 'LDP-PCS'].map(plazaPoint),
    warnings: [],
  },
  trunk_roads: {
    road: 'Maju Expressway (MEX)',
    speedKph: 80,
    waypoints: ['MEX-SLK', 'MEX-SKB', 'MEX-PTJ'].map(plazaPoint),
    warnings: [],
  },
  avoid_tolls: {
    road: 'Jalan Cheras and Federal Highway',
    speedKph: 38,
    // Surface-road waypoints chosen well clear of every plaza in the dataset.
    waypoints: [
      [101.715, 3.12],
      [101.725, 3.07],
    ],
    warnings: [
      { kind: 'flood_prone', message: 'Low-lying stretch near Sungai Klang can flood in heavy rain (sample alert).' },
      { kind: 'unpaved', message: 'Short unpaved shoulder diversion near a roadworks zone (sample alert).' },
    ],
  },
};

function inKlangValley([lng, lat]: LngLat): boolean {
  return lng >= KLANG_VALLEY[0] && lng <= KLANG_VALLEY[2] && lat >= KLANG_VALLEY[1] && lat <= KLANG_VALLEY[3];
}

/** Midpoint pushed sideways by `fraction` of the trip length, for a plausible alternative. */
function detour(a: LngLat, b: LngLat, fraction: number): LngLat {
  const mid: LngLat = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  return [mid[0] - dy * fraction, mid[1] + dx * fraction];
}

const NON_KV_ROUTES: Record<RouteProfile, { road: string; speedKph: number; sideways: number; warnings: RouteWarning[] }> = {
  fastest: { road: 'Federal Route main road', speedKph: 75, sideways: 0, warnings: [] },
  avoid_tolls: { road: 'Old trunk road', speedKph: 45, sideways: 0.06, warnings: [] },
  trunk_roads: {
    road: 'State trunk road',
    speedKph: 55,
    sideways: -0.06,
    warnings: [{ kind: 'unpaved', message: 'Rural stretch with a gravel patch ahead (sample alert).' }],
  },
};

/**
 * One step per anchor. Anchors ARE the route shape, so step i covers shape indices
 * [i, i + 1] and the arrival step sits on the last point (begin = end), like Valhalla.
 * Step 1 carries sample lanes and, on expressway corridors, sample exit 1107, so the
 * HUD's lane row and exit badge can be seen without a routing server.
 */
function buildSteps(
  anchors: LngLat[],
  road: string,
  speedKph: number,
  destination: Place,
  expressway: boolean,
): RouteStep[] {
  const metresPerSecond = (speedKph * 1000) / 3600;
  const steps: RouteStep[] = [];
  for (let i = 0; i < anchors.length - 1; i += 1) {
    const distanceM = Math.round(haversineM(anchors[i], anchors[i + 1]));
    steps.push({
      instruction: i === 0 ? `Head toward ${road}` : `Continue on ${road}`,
      distanceM,
      durationSec: Math.round(distanceM / metresPerSecond),
      type: i === 0 ? 1 : i === 1 ? 20 : 8,
      streetNames: [road],
      location: [anchors[i][0], anchors[i][1]],
      beginShapeIndex: i,
      endShapeIndex: i + 1,
      lanes:
        i === 1
          ? [
              { directions: ['left'], active: false },
              { directions: ['through', 'slight_right'], active: true },
              { directions: ['through', 'slight_right'], active: true },
              { directions: ['right'], active: false },
            ]
          : [],
      exitNumber: expressway && i === 1 ? '1107' : undefined,
      exitBranch: expressway && i === 1 ? road : undefined,
      exitToward: undefined,
      toll: false,
    });
  }
  const last = anchors[anchors.length - 1];
  steps.push({
    instruction: `Arrive at ${destination.name}`,
    distanceM: 0,
    durationSec: 0,
    type: 4,
    streetNames: [],
    location: [last[0], last[1]],
    beginShapeIndex: anchors.length - 1,
    endShapeIndex: anchors.length - 1,
    lanes: [],
    exitNumber: undefined,
    exitBranch: undefined,
    exitToward: undefined,
    toll: false,
  });
  return steps;
}

export function buildMockRawRoutes(
  origin: { lng: number; lat: number },
  destination: Place,
): Record<RouteProfile, RawRoute> {
  const from: LngLat = [origin.lng, origin.lat];
  const to: LngLat = [destination.lng, destination.lat];
  const local = inKlangValley(from) && inKlangValley(to);

  const make = (profile: RouteProfile): RawRoute => {
    let road: string;
    let speedKph: number;
    let via: LngLat[];
    let warnings: RouteWarning[];
    let expressway = false;

    if (local) {
      const corridor = KV_CORRIDORS[profile];
      ({ road, speedKph, warnings } = corridor);
      via = corridor.waypoints;
      expressway = profile !== 'avoid_tolls';
    } else {
      const spec = NON_KV_ROUTES[profile];
      ({ road, speedKph, warnings } = spec);
      via = spec.sideways === 0 ? [] : [detour(from, to, spec.sideways)];
    }

    const anchors = [from, ...via, to];
    const distanceM = Math.round(pathLengthM(anchors));
    return {
      shape: anchors,
      steps: buildSteps(anchors, road, speedKph, destination, expressway),
      distanceM,
      durationSec: Math.round(distanceM / ((speedKph * 1000) / 3600)),
      hasToll: false,
      hasFerry: false,
      extraWarnings: warnings,
    };
  };

  return { fastest: make('fastest'), avoid_tolls: make('avoid_tolls'), trunk_roads: make('trunk_roads') };
}
