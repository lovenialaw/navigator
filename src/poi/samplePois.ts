/**
 * Demo data for the "Along Your Route" panel, used ONLY when the Overpass URL is a
 * `.invalid` placeholder. Points are placed on the route itself at regular intervals
 * and are named "Sample ...": they are not real businesses or real alerts.
 */
import type { Alert } from '../alerts/alertTypes';
import type { LngLat } from '../utils/geo';
import { buildRouteGeometry, locateAlong } from '../utils/mapMatcher';
import type { Poi } from './poiTypes';

type SampleSpec = Pick<Poi, 'kind' | 'name' | 'brand' | 'operator'>;

const SAMPLE_CYCLE: SampleSpec[] = [
  { kind: 'fuel', name: 'Sample Petronas', brand: 'petronas' },
  { kind: 'rnr', name: 'Sample R&R' },
  { kind: 'ev', name: 'Sample EV charger', operator: 'Sample network' },
  { kind: 'fuel', name: 'Sample Shell', brand: 'shell' },
  { kind: 'rnr', name: 'Sample R&R Lay-by' },
  { kind: 'fuel', name: 'Sample Caltex', brand: 'caltex' },
  { kind: 'ev', name: 'Sample EV charger', operator: 'Sample network' },
  { kind: 'fuel', name: 'Sample BHPetrol', brand: 'bhpetrol' },
  { kind: 'rnr', name: 'Sample R&R Rest Area' },
  { kind: 'fuel', name: 'Sample Petron', brand: 'petron' },
];

export function buildSamplePois(shape: readonly LngLat[]): Poi[] {
  const geometry = buildRouteGeometry(shape, []);
  if (geometry.totalM < 500) return [];
  const spacing = Math.min(9000, Math.max(1200, geometry.totalM / 12));
  const pois: Poi[] = [];
  for (let i = 0; spacing * (i + 0.6) < geometry.totalM - 200; i += 1) {
    const { point } = locateAlong(geometry, spacing * (i + 0.6));
    pois.push({ ...SAMPLE_CYCLE[i % SAMPLE_CYCLE.length], id: `sample:${i}`, lng: point[0], lat: point[1], sample: true });
  }
  return pois;
}

export function buildSampleAlerts(shape: readonly LngLat[], nowMs: number): Alert[] {
  const geometry = buildRouteGeometry(shape, []);
  if (geometry.totalM < 1000) return [];
  const at = (fraction: number) => locateAlong(geometry, geometry.totalM * fraction).point;
  const flood = at(0.55);
  const slide = at(0.8);
  return [
    {
      id: 'sample:flood',
      kind: 'flood',
      title: 'Sample flood warning (JPS)',
      severity: 'warning',
      source: 'JPS',
      lng: flood[0],
      lat: flood[1],
      radiusM: 1500,
      expiresAt: nowMs + 6 * 3600_000,
    },
    {
      id: 'sample:landslide',
      kind: 'landslide',
      title: 'Sample landslide watch (LLM)',
      severity: 'watch',
      source: 'LLM',
      lng: slide[0],
      lat: slide[1],
      radiusM: 2500,
      expiresAt: nowMs + 6 * 3600_000,
    },
  ];
}
