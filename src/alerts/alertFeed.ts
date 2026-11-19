import { z } from 'zod';

import type { KeyValueStore } from '../storage/keyValueStore';
import { activeAlerts, alertSchema, parseAlertFeed, type Alert } from './alertTypes';

export const ALERT_CACHE_KEY = 'tuju.alerts.v1';
/** Alerts change slowly; this also keeps a public feed from being polled while driving. */
export const ALERT_TTL_MS = 15 * 60 * 1000;
const TIMEOUT_MS = 10_000;

const cacheSchema = z.object({ savedAt: z.number().int().nonnegative(), alerts: z.array(alertSchema).max(500) });

export type AlertFeedSource = 'network' | 'cache' | 'stale' | 'none';

export interface AlertFeedResult {
  alerts: Alert[];
  source: AlertFeedSource;
}

function readCache(store: KeyValueStore) {
  const raw = store.getString(ALERT_CACHE_KEY);
  if (!raw) return null;
  try {
    const parsed = cacheSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
  } catch {
    // fall through
  }
  store.remove(ALERT_CACHE_KEY);
  return null;
}

export interface LoadAlertsParams {
  store: KeyValueStore;
  /** Null when no feed is configured. */
  url: string | null;
  fetch?: typeof fetch;
  signal?: AbortSignal;
  now?: () => number;
}

/**
 * Fresh cache -> network -> stale cache. Offline, the last alerts still show (minus any
 * that have since expired), which is the useful behaviour in a rural dead zone.
 */
export async function loadAlerts(params: LoadAlertsParams): Promise<AlertFeedResult> {
  const now = (params.now ?? Date.now)();
  const cached = readCache(params.store);
  if (!params.url) return { alerts: [], source: 'none' };
  if (cached && now - cached.savedAt < ALERT_TTL_MS) {
    return { alerts: activeAlerts(cached.alerts, now), source: 'cache' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const onAbort = () => controller.abort();
  params.signal?.addEventListener('abort', onAbort);
  try {
    const response = await (params.fetch ?? fetch)(params.url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`alert feed returned ${response.status}`);
    const alerts = parseAlertFeed(await response.json(), now);
    params.store.set(ALERT_CACHE_KEY, JSON.stringify({ savedAt: now, alerts }));
    return { alerts, source: 'network' };
  } catch {
    if (cached) return { alerts: activeAlerts(cached.alerts, now), source: 'stale' };
    return { alerts: [], source: 'none' };
  } finally {
    clearTimeout(timer);
    params.signal?.removeEventListener('abort', onAbort);
  }
}
