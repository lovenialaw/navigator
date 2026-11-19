import { useEffect, useState } from 'react';

import { ALERT_TTL_MS, loadAlerts, type AlertFeedSource } from '../alerts/alertFeed';
import type { Alert } from '../alerts/alertTypes';
import { isPlaceholderUrl } from '../config/tujuConfig';
import type { PlannedRoute } from '../routing/routeTypes';
import type { KeyValueStore } from '../storage/keyValueStore';
import { buildRouteGeometry } from '../utils/mapMatcher';
import { corridorCovers } from './alongRoute';
import { corridorPoints, fetchRoutePois } from './overpassClient';
import { loadPoiCache, savePoiCache } from './poiStore';
import type { Poi } from './poiTypes';
import { buildSampleAlerts, buildSamplePois } from './samplePois';

/** A new route reuses cached POIs when it stays this close to the corridor they were fetched along. */
const REUSE_TOLERANCE_M = 400;

export type PoiStatus = 'idle' | 'loading' | 'ready' | 'sample' | 'error';

export interface CompanionData {
  pois: Poi[];
  poiStatus: PoiStatus;
  alerts: Alert[];
  alertStatus: AlertFeedSource | 'sample' | 'idle';
}

interface Params {
  store: KeyValueStore;
  route: PlannedRoute | null;
  /** Only fetch while actually navigating, so merely previewing a route costs no requests. */
  enabled: boolean;
  overpassUrl: string;
  alertsUrl: string | null;
}

const IDLE: CompanionData = { pois: [], poiStatus: 'idle', alerts: [], alertStatus: 'idle' };

/**
 * Loads the "Along Your Route" data for the active route. Order of preference:
 * cached POIs (offline-safe) -> one Overpass request -> nothing. A re-route or an added
 * stop that stays on the same corridor reuses the cache, so those cost no request.
 */
export function useRouteCompanion({ store, route, enabled, overpassUrl, alertsUrl }: Params): CompanionData {
  const [data, setData] = useState<CompanionData>(IDLE);
  const routeId = route?.id ?? null;
  const demo = isPlaceholderUrl(overpassUrl);

  useEffect(() => {
    if (!enabled || !route) {
      setData(IDLE);
      return undefined;
    }
    const controller = new AbortController();
    const { shape } = route;

    if (demo) {
      setData((prev) => ({ ...prev, pois: buildSamplePois(shape), poiStatus: 'sample' }));
      return () => controller.abort();
    }

    const cached = loadPoiCache(store);
    const reusable =
      cached !== null && corridorCovers(buildRouteGeometry(cached.corridor, []), shape, REUSE_TOLERANCE_M);
    if (cached && reusable) {
      savePoiCache(store, { ...cached, routeId: route.id });
      setData((prev) => ({ ...prev, pois: cached.pois, poiStatus: 'ready' }));
      return () => controller.abort();
    }

    // Different road: keep showing the old list until the new one arrives.
    setData((prev) => ({ ...prev, poiStatus: 'loading' }));
    fetchRoutePois({ overpassUrl, shape, signal: controller.signal })
      .then((pois) => {
        if (controller.signal.aborted) return;
        savePoiCache(store, {
          routeId: route.id,
          savedAt: Date.now(),
          corridor: corridorPoints(shape).map(([lng, lat]): [number, number] => [lng, lat]),
          pois,
        });
        setData((prev) => ({ ...prev, pois, poiStatus: 'ready' }));
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        // No signal: fall back to whatever was cached, even for another stretch.
        setData((prev) => ({ ...prev, poiStatus: 'error', pois: cached?.pois ?? prev.pois }));
      });
    return () => controller.abort();
    // The route's identity decides this, not every re-render of its object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, routeId, overpassUrl, store, demo]);

  useEffect(() => {
    if (!enabled || !route) return undefined;
    if (demo) {
      setData((prev) => ({ ...prev, alerts: buildSampleAlerts(route.shape, Date.now()), alertStatus: 'sample' }));
      return undefined;
    }
    const controller = new AbortController();
    const refresh = () => {
      loadAlerts({ store, url: alertsUrl, signal: controller.signal }).then((result) => {
        if (!controller.signal.aborted) {
          setData((prev) => ({ ...prev, alerts: result.alerts, alertStatus: result.source }));
        }
      });
    };
    refresh();
    const timer = setInterval(refresh, ALERT_TTL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, routeId, alertsUrl, store, demo]);

  return data;
}
