/**
 * TUJU runtime configuration. This is the ONLY module that knows about the map
 * style URL and the regional .pmtiles pack URLs.
 *
 * The real endpoints are not decided yet, so every URL below is a placeholder on
 * the reserved `.invalid` TLD. Placeholders never hit the network: the app falls
 * back to a bundled offline style and the pack drawer shows "URL not configured".
 *
 * Override without editing code by setting Expo public env vars (in `.env`, in the
 * shell before `expo start`, or in EAS build profiles):
 *
 *   EXPO_PUBLIC_TUJU_STYLE_URL        full MapLibre style JSON URL (malaysia.pmtiles style)
 *   EXPO_PUBLIC_TUJU_STYLE_SOURCE_ID  id of the vector source in that style that offline packs replace
 *   EXPO_PUBLIC_TUJU_PACK_BASE_URL    directory URL that hosts <pack>.pmtiles files
 *   EXPO_PUBLIC_TUJU_PACK_URL_<ID>    full URL for one pack, wins over the base URL.
 *                                     <ID> = KLANG_VALLEY | PAHANG_EAST_COAST | SABAH | SARAWAK
 *
 * See docs/offline-maps.md.
 */
import { z } from 'zod';

export const PLACEHOLDER_HOST_SUFFIX = '.invalid';

export const DEFAULT_STYLE_URL = 'https://tiles.tuju.invalid/styles/malaysia/style.json';
export const DEFAULT_PACK_BASE_URL = 'https://tiles.tuju.invalid/packs';
export const DEFAULT_STYLE_SOURCE_ID = 'malaysia';

const httpUrl = z
  .string()
  .trim()
  .url()
  .refine((value) => /^https?:\/\//i.test(value), 'must be an http(s) URL');

const lng = z.number().min(-180).max(180);
const lat = z.number().min(-90).max(90);

export const packDefinitionSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  description: z.string(),
  /** [west, south, east, north] */
  bounds: z.tuple([lng, lat, lng, lat]),
  url: httpUrl,
  /** Rough download size, used for the disk-space pre-check and as a UI hint. */
  approxBytes: z.number().int().positive(),
});
export type PackDefinition = z.infer<typeof packDefinitionSchema>;

export const tujuConfigSchema = z.object({
  styleUrl: httpUrl,
  styleSourceId: z.string().min(1),
  packs: z
    .array(packDefinitionSchema)
    .min(1)
    .refine((packs) => new Set(packs.map((p) => p.id)).size === packs.length, 'pack ids must be unique'),
});
export type TujuConfig = z.infer<typeof tujuConfigSchema>;

const MB = 1024 * 1024;

interface PackSeed {
  id: string;
  envKey: string;
  fileName: string;
  name: string;
  description: string;
  bounds: [number, number, number, number];
  approxBytes: number;
}

const PACK_SEEDS: PackSeed[] = [
  {
    id: 'klang-valley',
    envKey: 'KLANG_VALLEY',
    fileName: 'klang-valley.pmtiles',
    name: 'Klang Valley',
    description: 'Kuala Lumpur, Selangor, Putrajaya',
    bounds: [101.2, 2.6, 101.95, 3.5],
    approxBytes: 180 * MB,
  },
  {
    id: 'pahang-east-coast',
    envKey: 'PAHANG_EAST_COAST',
    fileName: 'pahang-east-coast.pmtiles',
    name: 'Pahang / East Coast',
    description: 'Pahang, Terengganu, Kelantan',
    bounds: [101.3, 2.4, 104.7, 6.3],
    approxBytes: 260 * MB,
  },
  {
    id: 'sabah',
    envKey: 'SABAH',
    fileName: 'sabah.pmtiles',
    name: 'Sabah',
    description: 'Sabah and Labuan',
    bounds: [115.2, 3.9, 119.4, 7.4],
    approxBytes: 220 * MB,
  },
  {
    id: 'sarawak',
    envKey: 'SARAWAK',
    fileName: 'sarawak.pmtiles',
    name: 'Sarawak',
    description: 'Sarawak',
    bounds: [109.5, 0.8, 115.7, 5.1],
    approxBytes: 240 * MB,
  },
];

export type TujuEnv = Partial<Record<string, string | undefined>>;

/**
 * Metro only inlines `process.env.EXPO_PUBLIC_*` when the full name appears
 * literally, so every supported variable is listed here by hand.
 */
export function readExpoPublicEnv(): TujuEnv {
  return {
    EXPO_PUBLIC_TUJU_STYLE_URL: process.env.EXPO_PUBLIC_TUJU_STYLE_URL,
    EXPO_PUBLIC_TUJU_STYLE_SOURCE_ID: process.env.EXPO_PUBLIC_TUJU_STYLE_SOURCE_ID,
    EXPO_PUBLIC_TUJU_PACK_BASE_URL: process.env.EXPO_PUBLIC_TUJU_PACK_BASE_URL,
    EXPO_PUBLIC_TUJU_PACK_URL_KLANG_VALLEY: process.env.EXPO_PUBLIC_TUJU_PACK_URL_KLANG_VALLEY,
    EXPO_PUBLIC_TUJU_PACK_URL_PAHANG_EAST_COAST: process.env.EXPO_PUBLIC_TUJU_PACK_URL_PAHANG_EAST_COAST,
    EXPO_PUBLIC_TUJU_PACK_URL_SABAH: process.env.EXPO_PUBLIC_TUJU_PACK_URL_SABAH,
    EXPO_PUBLIC_TUJU_PACK_URL_SARAWAK: process.env.EXPO_PUBLIC_TUJU_PACK_URL_SARAWAK,
  };
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** Pure and throws a ZodError with readable paths when an override is malformed. */
export function buildConfig(env: TujuEnv = {}): TujuConfig {
  const baseUrl = (clean(env.EXPO_PUBLIC_TUJU_PACK_BASE_URL) ?? DEFAULT_PACK_BASE_URL).replace(/\/+$/, '');

  return tujuConfigSchema.parse({
    styleUrl: clean(env.EXPO_PUBLIC_TUJU_STYLE_URL) ?? DEFAULT_STYLE_URL,
    styleSourceId: clean(env.EXPO_PUBLIC_TUJU_STYLE_SOURCE_ID) ?? DEFAULT_STYLE_SOURCE_ID,
    packs: PACK_SEEDS.map((seed) => ({
      id: seed.id,
      name: seed.name,
      description: seed.description,
      bounds: seed.bounds,
      approxBytes: seed.approxBytes,
      url: clean(env[`EXPO_PUBLIC_TUJU_PACK_URL_${seed.envKey}`]) ?? `${baseUrl}/${seed.fileName}`,
    })),
  });
}

/** True while a URL still points at the reserved placeholder host. */
export function isPlaceholderUrl(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase().endsWith(PLACEHOLDER_HOST_SUFFIX);
  } catch {
    return true;
  }
}

export interface ConfigLoadResult {
  config: TujuConfig;
  /** Set when an env override was malformed and defaults were used instead. */
  error: string | null;
}

/** Never throws: a bad override must not stop a driver from opening the map. */
export function loadConfig(env: TujuEnv = readExpoPublicEnv()): ConfigLoadResult {
  try {
    return { config: buildConfig(env), error: null };
  } catch (e) {
    const message = e instanceof z.ZodError ? z.prettifyError(e) : String(e);
    return { config: buildConfig({}), error: message };
  }
}
