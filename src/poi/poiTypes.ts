import { z } from 'zod';

import { optionalSafeText, safeText } from '../utils/safeText';

export const POI_KINDS = ['rnr', 'fuel', 'ev'] as const;
export type PoiKind = (typeof POI_KINDS)[number];

export const POI_KIND_LABEL: Record<PoiKind, string> = {
  rnr: 'R&R',
  fuel: 'Petrol',
  ev: 'EV',
};

export const FUEL_BRANDS = ['petronas', 'shell', 'petron', 'caltex', 'bhpetrol', 'other'] as const;
export type FuelBrand = (typeof FUEL_BRANDS)[number];

const lng = z.number().min(-180).max(180);
const lat = z.number().min(-90).max(90);

export const poiSchema = z.object({
  /** Stable across sessions, e.g. "osm:node:123". Doubles as the waypoint id. */
  id: z.string().min(1).max(80),
  kind: z.enum(POI_KINDS),
  name: safeText(100).pipe(z.string().min(1)),
  /** Fuel stations only. */
  brand: z.enum(FUEL_BRANDS).optional(),
  /** EV chargers: network such as "Gentari" or "ChargEV". */
  operator: optionalSafeText(60).optional(),
  lng,
  lat,
  /** True for generated demo data, never for anything from a real source. */
  sample: z.boolean().default(false),
});
export type Poi = z.infer<typeof poiSchema>;

/** A POI projected onto the active route. */
export interface RoutePoi extends Poi {
  /** Metres from the route start to the closest point on the route. */
  alongM: number;
  /** How far the POI sits off the route line, metres. */
  offsetM: number;
}

/**
 * Brand colours for the petrol badges. These are plain coloured letter badges, not the
 * companies' logos, which we neither ship nor have the right to.
 */
export const BRAND_STYLE: Record<FuelBrand, { label: string; background: string; foreground: string }> = {
  petronas: { label: 'P', background: '#00A19C', foreground: '#FFFFFF' },
  shell: { label: 'S', background: '#FBCE07', foreground: '#C8102E' },
  petron: { label: 'Pt', background: '#0033A0', foreground: '#FFFFFF' },
  caltex: { label: 'C', background: '#E4002B', foreground: '#FFFFFF' },
  bhpetrol: { label: 'BH', background: '#00843D', foreground: '#FFE500' },
  other: { label: '⛽', background: '#5B6770', foreground: '#FFFFFF' },
};

/** Best-effort brand from OSM tags. "petronas" must be tested before "petron". */
export function detectBrand(tags: Readonly<Record<string, string>>): FuelBrand {
  const text = `${tags.brand ?? ''} ${tags.operator ?? ''} ${tags.name ?? ''}`.toLowerCase();
  if (text.includes('petronas')) return 'petronas';
  if (text.includes('shell')) return 'shell';
  if (text.includes('petron')) return 'petron';
  if (text.includes('caltex')) return 'caltex';
  if (/\bbh\b|bhp/.test(text)) return 'bhpetrol';
  return 'other';
}
