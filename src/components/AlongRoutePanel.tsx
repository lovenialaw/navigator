import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AlertFeedSource } from '../alerts/alertFeed';
import { alertsAhead, distanceToAlertM, nextAhead, type RouteAlert } from '../poi/alongRoute';
import { BRAND_STYLE, POI_KIND_LABEL, type PoiKind, type RoutePoi } from '../poi/poiTypes';
import type { PoiStatus } from '../poi/useRouteCompanion';
import { MIN_TOUCH_TARGET, useTheme } from '../theme/theme';

type Tab = PoiKind | 'alerts';

const TABS: { id: Tab; label: string }[] = [
  { id: 'rnr', label: 'R&R' },
  { id: 'fuel', label: 'Fuel' },
  { id: 'ev', label: 'EV' },
  { id: 'alerts', label: 'Alerts' },
];

/** The collapsed tab also surfaces an alert this close, because it matters more than any stop. */
const ALERT_PEEK_M = 10_000;
const ROWS = 3;

const SEVERITY_COLOR = { watch: '#FFC400', warning: '#FF9F1C', danger: '#FF4D4D' } as const;

/** Exact distance in kilometres, one decimal, as the driver asked for. */
export function kmText(meters: number): string {
  return `${(Math.max(0, meters) / 1000).toFixed(1)} km`;
}

interface Props {
  pois: readonly RoutePoi[];
  alerts: readonly RouteAlert[];
  /** Metres driven along the route. */
  alongM: number;
  poiStatus: PoiStatus;
  alertStatus: AlertFeedSource | 'sample' | 'idle';
  /** Ids of stops already added to the trip. */
  stopIds: readonly string[];
  /** Tapping a stop adds it (or removes it when it was already added). */
  onToggleStop: (poi: RoutePoi) => void;
}

/**
 * Collapsible side strip on the navigation HUD. Shows the next three R&R, petrol
 * stations and EV chargers, plus active flood and landslide alerts, each with its exact
 * distance. Nearest sits at the bottom, next to the car, so the strip reads as the road
 * ahead. One tap on a stop adds it; the final destination is never replaced.
 */
export function AlongRoutePanel({ pois, alerts, alongM, poiStatus, alertStatus, stopIds, onToggleStop }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('rnr');

  const byKind = useMemo(() => {
    const groups: Record<PoiKind, RoutePoi[]> = { rnr: [], fuel: [], ev: [] };
    for (const poi of pois) groups[poi.kind].push(poi);
    return groups;
  }, [pois]);

  const upcomingAlerts = alertsAhead(alerts, alongM, ROWS);
  const peekAlert = upcomingAlerts.find((a) => distanceToAlertM(a, alongM) <= ALERT_PEEK_M);
  const top = insets.top + 250;

  if (!open) {
    return (
      <View pointerEvents="box-none" style={[styles.wrap, { top }]}>
        {peekAlert ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${peekAlert.title}, ${kmText(distanceToAlertM(peekAlert, alongM))} ahead`}
            onPress={() => {
              setTab('alerts');
              setOpen(true);
            }}
            style={[styles.peek, { backgroundColor: SEVERITY_COLOR[peekAlert.severity] }]}
          >
            <Text style={styles.peekText}>⚠ {kmText(distanceToAlertM(peekAlert, alongM))}</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Along your route"
          accessibilityHint="Opens the next rest areas, petrol stations, EV chargers and alerts"
          onPress={() => setOpen(true)}
          style={[styles.tab, { backgroundColor: theme.surface, borderColor: theme.border }]}
        >
          <Text style={[styles.tabGlyph, { color: theme.accent }]}>◀</Text>
          <Text style={[styles.tabText, { color: theme.text }]}>Along</Text>
        </Pressable>
      </View>
    );
  }

  const rows: { key: string; node: ReactNode }[] = [];
  if (tab === 'alerts') {
    for (const alert of upcomingAlerts) {
      const distance = distanceToAlertM(alert, alongM);
      rows.push({
        key: alert.id,
        node: (
          <View
            accessible
            accessibilityLabel={`${alert.title}. ${distance > 0 ? `${kmText(distance)} ahead` : 'You are inside the alert area'}`}
            style={styles.row}
          >
            <View style={[styles.badge, { backgroundColor: SEVERITY_COLOR[alert.severity] }]}>
              <Text style={[styles.badgeText, { color: '#000000' }]}>⚠</Text>
            </View>
            <View style={styles.rowText}>
              <Text style={[styles.rowTitle, { color: theme.text }]} numberOfLines={2}>
                {alert.title}
              </Text>
              <Text style={[styles.rowSub, { color: theme.textMuted }]}>
                {alert.kind === 'flood' ? 'Flood' : 'Landslide'}
                {alert.source !== 'other' ? ` · ${alert.source}` : ''}
              </Text>
            </View>
            <Text style={[styles.distance, { color: distance > 0 ? theme.accent : theme.danger }]}>
              {distance > 0 ? kmText(distance) : 'Inside'}
            </Text>
          </View>
        ),
      });
    }
  } else {
    for (const poi of nextAhead(byKind[tab], alongM, ROWS)) {
      const added = stopIds.includes(poi.id);
      const brand = poi.kind === 'fuel' ? BRAND_STYLE[poi.brand ?? 'other'] : null;
      rows.push({
        key: poi.id,
        node: (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${poi.name}, ${kmText(poi.alongM - alongM)} ahead`}
            accessibilityHint={added ? 'Removes this stop from your trip' : 'Adds this as a stop. Your destination stays the same'}
            accessibilityState={{ selected: added }}
            onPress={() => onToggleStop(poi)}
            style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1 }]}
          >
            <View
              style={[
                styles.badge,
                { backgroundColor: brand?.background ?? (poi.kind === 'ev' ? '#2563EB' : '#0F766E') },
              ]}
            >
              <Text style={[styles.badgeText, { color: brand?.foreground ?? '#FFFFFF' }]}>
                {brand ? brand.label : poi.kind === 'ev' ? '⚡' : 'R'}
              </Text>
            </View>
            <View style={styles.rowText}>
              <Text style={[styles.rowTitle, { color: theme.text }]} numberOfLines={2}>
                {poi.name}
              </Text>
              <Text style={[styles.rowSub, { color: added ? theme.success : theme.textMuted }]} numberOfLines={1}>
                {added ? '✓ Stop added · tap to remove' : 'Tap to add as a stop'}
              </Text>
            </View>
            <Text style={[styles.distance, { color: theme.accent }]}>{kmText(poi.alongM - alongM)}</Text>
          </Pressable>
        ),
      });
    }
  }

  const emptyText = (() => {
    if (tab === 'alerts') {
      if (alertStatus === 'none') return 'No alert feed connected yet.';
      if (alertStatus === 'idle') return 'Checking for alerts…';
      return 'No active flood or landslide alerts on your route.';
    }
    if (poiStatus === 'loading') return 'Finding stops along your route…';
    if (poiStatus === 'error') return 'Stops unavailable. Connect once to load them.';
    return `No ${POI_KIND_LABEL[tab]} stop ahead on this route.`;
  })();

  const footnote =
    tab === 'alerts'
      ? alertStatus === 'sample'
        ? 'Demo alerts'
        : alertStatus === 'stale'
          ? 'Offline: last known alerts'
          : null
      : poiStatus === 'sample'
        ? 'Demo stops'
        : poiStatus === 'error' && pois.length > 0
          ? 'Offline: saved stops'
          : null;

  return (
    <View
      style={[styles.panel, { top, backgroundColor: theme.surface, borderColor: theme.border }]}
      accessibilityLabel="Along your route"
    >
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.text }]}>Along your route</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Collapse along your route"
          onPress={() => setOpen(false)}
          style={styles.close}
        >
          <Text style={[styles.tabGlyph, { color: theme.accent }]}>▶</Text>
        </Pressable>
      </View>

      <View style={styles.tabs}>
        {TABS.map((item) => {
          const selected = item.id === tab;
          const hasAlert = item.id === 'alerts' && upcomingAlerts.length > 0;
          return (
            <Pressable
              key={item.id}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={item.label}
              onPress={() => setTab(item.id)}
              style={[
                styles.tabButton,
                {
                  backgroundColor: selected ? theme.accent : theme.surfaceRaised,
                  borderColor: hasAlert ? SEVERITY_COLOR[upcomingAlerts[0].severity] : theme.border,
                },
              ]}
            >
              <Text style={[styles.tabButtonText, { color: selected ? theme.onAccent : theme.text }]}>
                {item.id === 'alerts' && hasAlert ? `⚠ ${item.label}` : item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {rows.length === 0 ? (
        <Text style={[styles.empty, { color: theme.textMuted }]}>{emptyText}</Text>
      ) : (
        <View style={styles.rail}>
          {/* Farthest on top, nearest next to the car at the bottom. */}
          <View style={[styles.railLine, { backgroundColor: theme.border }]} />
          <View style={styles.railRows}>
            {[...rows].reverse().map((row) => (
              <View key={row.key} style={styles.railItem}>
                <View style={[styles.node, { backgroundColor: theme.accent, borderColor: theme.surface }]} />
                {row.node}
              </View>
            ))}
          </View>
          <View style={styles.carRow}>
            <View style={[styles.car, { backgroundColor: '#00E5FF', borderColor: '#FFFFFF' }]} />
            <Text style={[styles.rowSub, { color: theme.textMuted }]}>You</Text>
          </View>
        </View>
      )}

      {footnote ? <Text style={[styles.footnote, { color: theme.textMuted }]}>{footnote}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', right: 0, alignItems: 'flex-end', gap: 8 },
  tab: {
    minWidth: 56,
    minHeight: 72,
    borderWidth: 2,
    borderRightWidth: 0,
    borderTopLeftRadius: 16,
    borderBottomLeftRadius: 16,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabGlyph: { fontSize: 16, fontWeight: '900' },
  tabText: { fontSize: 13, fontWeight: '800' },
  peek: {
    minHeight: MIN_TOUCH_TARGET,
    minWidth: 96,
    borderTopLeftRadius: 16,
    borderBottomLeftRadius: 16,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  peekText: { color: '#000000', fontSize: 18, fontWeight: '900' },
  panel: {
    position: 'absolute',
    right: 0,
    width: 292,
    maxWidth: '86%',
    borderWidth: 2,
    borderRightWidth: 0,
    borderTopLeftRadius: 18,
    borderBottomLeftRadius: 18,
    paddingLeft: 10,
    paddingRight: 8,
    paddingVertical: 8,
    gap: 8,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 16, fontWeight: '900' },
  close: { minWidth: MIN_TOUCH_TARGET, minHeight: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
  tabs: { flexDirection: 'row', gap: 4 },
  tabButton: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    borderWidth: 2,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabButtonText: { fontSize: 13, fontWeight: '800' },
  rail: { position: 'relative' },
  railLine: { position: 'absolute', left: 5, top: 12, bottom: 12, width: 3, borderRadius: 2 },
  railRows: { gap: 2 },
  railItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  node: { width: 13, height: 13, borderRadius: 7, borderWidth: 2 },
  row: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 60, paddingVertical: 4 },
  badge: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 16, fontWeight: '900' },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 14, fontWeight: '800' },
  rowSub: { fontSize: 12, fontWeight: '600' },
  distance: { fontSize: 16, fontWeight: '900', minWidth: 62, textAlign: 'right' },
  carRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 2 },
  car: { width: 13, height: 13, borderRadius: 7, borderWidth: 2 },
  empty: { fontSize: 14, fontWeight: '600', paddingVertical: 12, paddingRight: 4 },
  footnote: { fontSize: 11, fontWeight: '700', textAlign: 'right' },
});
