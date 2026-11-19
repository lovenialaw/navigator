import { z } from 'zod';

import { isPlaceholderUrl } from '../config/tujuConfig';
import type { KeyValueStore } from '../storage/keyValueStore';

export const STYLE_CACHE_KEY = 'tuju.mapStyle.v1';
const STYLE_FETCH_TIMEOUT_MS = 8000;

/**
 * Minimal subset of the MapLibre style spec that we rely on. Everything else passes
 * through untouched. The style JSON comes from the network, so it is validated.
 */
const styleSchema = z.looseObject({
  version: z.literal(8),
  sources: z.record(z.string(), z.looseObject({ type: z.string() })),
  layers: z.array(z.looseObject({ id: z.string(), type: z.string() })),
});
export type MapStyle = z.infer<typeof styleSchema>;

/** Dark, empty style shown while the real style is not configured or reachable. */
export const FALLBACK_STYLE: MapStyle = {
  version: 8,
  name: 'tuju-offline-fallback',
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#10151c' } }],
};

export function parseStyle(input: unknown): MapStyle | null {
  const parsed = styleSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function toPmtilesUrl(fileUri: string): string {
  return `pmtiles://${fileUri}`;
}

/**
 * Point the style's vector source at a local archive. Prefers `sourceId`; falls back to the
 * first vector source so a renamed source in the hosted style does not silently break offline maps.
 * Returns null when the style has no vector source to replace.
 */
export function applyPackToStyle(style: MapStyle, sourceId: string, packFileUri: string): MapStyle | null {
  const entries = Object.entries(style.sources);
  const target =
    entries.find(([id, source]) => id === sourceId && source.type === 'vector')?.[0] ??
    entries.find(([, source]) => source.type === 'vector')?.[0];
  if (!target) return null;

  const { tiles: _tiles, ...rest } = style.sources[target];
  return {
    ...style,
    sources: {
      ...style.sources,
      [target]: { ...rest, type: 'vector', url: toPmtilesUrl(packFileUri) },
    },
  };
}

export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/** Network first, so a fixed style rolls out to drivers; last good copy when offline. */
export async function loadStyleJson(
  styleUrl: string,
  deps: { fetch: FetchLike; storage: KeyValueStore; timeoutMs?: number },
): Promise<{ style: MapStyle; source: 'network' | 'cache' } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? STYLE_FETCH_TIMEOUT_MS);
  try {
    const response = await deps.fetch(styleUrl, { signal: controller.signal });
    if (response.ok) {
      const style = parseStyle(await response.json());
      if (style) {
        deps.storage.set(STYLE_CACHE_KEY, JSON.stringify({ url: styleUrl, style }));
        return { style, source: 'network' };
      }
    }
  } catch {
    // offline or timed out: use the cache below
  } finally {
    clearTimeout(timer);
  }
  return readCachedStyle(styleUrl, deps.storage);
}

function readCachedStyle(styleUrl: string, storage: KeyValueStore) {
  const raw = storage.getString(STYLE_CACHE_KEY);
  if (!raw) return null;
  try {
    const cached = z.object({ url: z.string(), style: z.unknown() }).parse(JSON.parse(raw));
    const style = cached.url === styleUrl ? parseStyle(cached.style) : null;
    return style ? { style, source: 'cache' as const } : null;
  } catch {
    return null;
  }
}

export type ResolvedMapStyle =
  | { kind: 'url'; mapStyle: string; note: null }
  | { kind: 'object'; mapStyle: MapStyle; note: ResolveNote | null };

export type ResolveNote = 'style-not-configured' | 'pack-not-applicable' | 'style-unavailable';

export interface ResolveInput {
  styleUrl: string;
  styleSourceId: string;
  activePackFileUri: string | null;
  fetch: FetchLike;
  storage: KeyValueStore;
}

/**
 * Decide what to hand to MapLibre.
 * - No active pack: the hosted style URL itself, so MapLibre streams the online archive immediately.
 * - Active pack: the hosted (or last cached) style with its vector source swapped for the local file.
 * - Placeholder URL: an empty dark style, so launch never blocks or crashes.
 */
export async function resolveMapStyle(input: ResolveInput): Promise<ResolvedMapStyle> {
  const { styleUrl, styleSourceId, activePackFileUri } = input;

  if (!activePackFileUri) {
    if (isPlaceholderUrl(styleUrl)) {
      return { kind: 'object', mapStyle: FALLBACK_STYLE, note: 'style-not-configured' };
    }
    return { kind: 'url', mapStyle: styleUrl, note: null };
  }

  const loaded = isPlaceholderUrl(styleUrl) ? null : await loadStyleJson(styleUrl, input);
  if (!loaded) {
    const note = isPlaceholderUrl(styleUrl) ? 'style-not-configured' : 'style-unavailable';
    return { kind: 'object', mapStyle: FALLBACK_STYLE, note };
  }
  const withPack = applyPackToStyle(loaded.style, styleSourceId, activePackFileUri);
  if (!withPack) {
    return { kind: 'object', mapStyle: loaded.style, note: 'pack-not-applicable' };
  }
  return { kind: 'object', mapStyle: withPack, note: null };
}
