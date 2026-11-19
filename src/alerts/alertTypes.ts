import { z } from 'zod';

import { sanitizeText } from '../utils/safeText';

export const ALERT_KINDS = ['flood', 'landslide'] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

export const ALERT_SEVERITIES = ['watch', 'warning', 'danger'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const ALERT_SOURCES = ['JPS', 'LLM', 'other'] as const;
export type AlertSource = (typeof ALERT_SOURCES)[number];

/** Alert areas are circles. Bigger than this is a state-wide advisory, not a road hazard. */
export const MAX_ALERT_RADIUS_M = 50_000;
export const DEFAULT_ALERT_RADIUS_M = 2000;

const lng = z.number().min(-180).max(180);
const lat = z.number().min(-90).max(90);

/** Unknown enum values from a feed fall back instead of dropping the alert: a hazard should still show. */
function lenientEnum<T extends readonly [string, ...string[]]>(values: T, fallback: T[number]) {
  // Case-insensitive match first; `.catch` also covers a missing key, which a bare transform does not.
  return z
    .preprocess(
      (value) =>
        typeof value === 'string' ? ((values as readonly string[]).find((v) => v.toLowerCase() === value.trim().toLowerCase()) ?? value) : value,
      z.enum(values),
    )
    .catch(fallback);
}

export const alertSchema = z.object({
  id: z.string().min(1).max(80),
  kind: z.enum(ALERT_KINDS),
  title: z
    .unknown()
    .transform((v) => sanitizeText(v, 120))
    .pipe(z.string().min(1)),
  severity: lenientEnum(ALERT_SEVERITIES, 'warning'),
  source: lenientEnum(ALERT_SOURCES, 'other'),
  lng,
  lat,
  radiusM: z.number().positive().max(MAX_ALERT_RADIUS_M).default(DEFAULT_ALERT_RADIUS_M),
  /** Epoch milliseconds. Missing means the feed did not say. */
  issuedAt: z.number().int().nonnegative().optional(),
  /** Past this the alert is hidden. Missing means "until the feed drops it". */
  expiresAt: z.number().int().nonnegative().optional(),
});
export type Alert = z.infer<typeof alertSchema>;

const feedSchema = z.union([z.array(z.unknown()), z.object({ alerts: z.array(z.unknown()) }).transform((v) => v.alerts)]);

/**
 * Parses a feed shaped `{ "alerts": [...] }` (or a bare array). Each alert is validated
 * alone; a malformed one is dropped, never allowed to hide the rest.
 */
export function parseAlertFeed(json: unknown, nowMs: number): Alert[] {
  const list = feedSchema.safeParse(json);
  if (!list.success) return [];
  const alerts: Alert[] = [];
  const seen = new Set<string>();
  for (const item of list.data) {
    const parsed = alertSchema.safeParse(item);
    if (!parsed.success || seen.has(parsed.data.id)) continue;
    if (parsed.data.expiresAt !== undefined && parsed.data.expiresAt <= nowMs) continue;
    seen.add(parsed.data.id);
    alerts.push(parsed.data);
  }
  return alerts;
}

/** Drops alerts that expired while they sat in the cache. */
export function activeAlerts(alerts: readonly Alert[], nowMs: number): Alert[] {
  return alerts.filter((a) => a.expiresAt === undefined || a.expiresAt > nowMs);
}
