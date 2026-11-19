import { useMemo } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatArrival, formatDistance, formatDuration, formatTollLabel } from '../routing/format';
import { ROUTE_PROFILE_LABEL, type PlannedRoute } from '../routing/routeTypes';
import type { RoutePlanner } from '../routing/useRoutePlanner';
import { useTheme } from '../theme/theme';
import { BigButton } from './BigButton';

interface Props {
  planner: RoutePlanner;
  /** Begins turn-by-turn guidance on the selected route. */
  onStart: () => void;
}

/** Bottom comparison sheet: ETA, distance, RM toll estimate and road warnings per route. */
export function RouteSheet({ planner, onStart }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { status, destination, origin, routes, active, mock, failedProfiles, error, sheetOpen } = planner;
  // Arrival times are computed from "now" at render of the candidate list, not per frame.
  const now = useMemo(() => Date.now(), [routes]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!sheetOpen || !destination) return null;

  const busy = status === 'locating' || status === 'planning';
  const anyPlaceholderRates = routes.some((r) => r.toll.placeholderData);

  return (
    <View
      style={[
        styles.sheet,
        { backgroundColor: theme.surface, borderColor: theme.border, paddingBottom: insets.bottom + 12 },
      ]}
    >
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
            To {destination.name}
          </Text>
          {origin?.source === 'fallback' ? (
            <Text style={[styles.sub, { color: theme.warning }]} numberOfLines={2}>
              Location unavailable, starting from Kuala Lumpur (KLCC).
            </Text>
          ) : null}
        </View>
        <BigButton label="Close" onPress={planner.closeSheet} accessibilityHint="Hides the route list" style={styles.close} />
      </View>

      {busy ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.accent} />
          <Text style={[styles.status, { color: theme.text }]}>
            {status === 'locating' ? 'Finding your location…' : 'Finding the best routes…'}
          </Text>
        </View>
      ) : null}

      {status === 'error' ? (
        <View style={styles.center}>
          <Text style={[styles.status, { color: theme.danger }]}>{error ?? 'Could not plan a route.'}</Text>
          <BigButton label="Try again" variant="primary" onPress={() => planner.planTo(destination)} />
        </View>
      ) : null}

      {status === 'ready' ? (
        <>
          {mock ? (
            <Text style={[styles.sub, { color: theme.warning }]}>Sample routes: routing server not set up yet.</Text>
          ) : null}
          {failedProfiles.length > 0 ? (
            <Text style={[styles.sub, { color: theme.warning }]}>
              Some options could not be loaded: {failedProfiles.map((p) => ROUTE_PROFILE_LABEL[p]).join(', ')}.
            </Text>
          ) : null}

          <ScrollView style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
            {routes.map((route) => (
              <RouteCard
                key={route.id}
                route={route}
                now={now}
                selected={active?.id === route.id}
                onSelect={() => planner.select(route.id)}
              />
            ))}
          </ScrollView>

          <Text style={[styles.footnote, { color: theme.textMuted }]}>
            Toll amounts are estimates{anyPlaceholderRates ? ' from sample rates' : ''}, Class 1 vehicles.
          </Text>
          <BigButton
            label="Start navigation"
            variant="primary"
            onPress={onStart}
            disabled={!active}
            accessibilityHint="Begins turn-by-turn guidance on the selected route"
            style={styles.start}
          />
        </>
      ) : null}
    </View>
  );
}

interface CardProps {
  route: PlannedRoute;
  now: number;
  selected: boolean;
  onSelect: () => void;
}

function RouteCard({ route, now, selected, onSelect }: CardProps) {
  const theme = useTheme();
  const label = ROUTE_PROFILE_LABEL[route.profile];
  const also = route.alsoProfiles.map((p) => ROUTE_PROFILE_LABEL[p]).join(', ');
  const toll = formatTollLabel(route);
  const duration = formatDuration(route.durationSec);
  const distance = formatDistance(route.distanceM);
  const arrival = formatArrival(now, route.durationSec);

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label} route. ${duration}, ${distance}, ${toll}. Arrive ${arrival}.`}
      onPress={onSelect}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: selected ? theme.surfaceRaised : theme.surface,
          borderColor: selected ? theme.accent : theme.border,
          borderWidth: selected ? 3 : 2,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <View style={styles.cardTop}>
        <Text style={[styles.cardLabel, { color: selected ? theme.accent : theme.text }]}>{label}</Text>
        <Text style={[styles.toll, { color: route.toll.totalRinggit > 0 ? theme.warning : theme.success }]}>{toll}</Text>
      </View>
      <View style={styles.cardMain}>
        <Text style={[styles.eta, { color: theme.text }]}>{duration}</Text>
        <Text style={[styles.meta, { color: theme.textMuted }]}>
          {distance} · arrive {arrival}
        </Text>
      </View>
      {also ? <Text style={[styles.meta, { color: theme.textMuted }]}>Also the {also.toLowerCase()} route</Text> : null}
      {route.warnings.map((w) => (
        <Text key={`${w.kind}-${w.message}`} style={[styles.warning, { color: theme.warning }]}>
          ⚠ {w.message}
        </Text>
      ))}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '68%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 2,
    borderBottomWidth: 0,
    paddingTop: 14,
    paddingHorizontal: 14,
    gap: 10,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerText: { flex: 1, gap: 2 },
  title: { fontSize: 20, fontWeight: '800' },
  sub: { fontSize: 14, fontWeight: '600' },
  close: { minWidth: 88 },
  start: { minHeight: 60 },
  center: { alignItems: 'center', gap: 12, paddingVertical: 20 },
  status: { fontSize: 17, fontWeight: '700', textAlign: 'center' },
  list: { flexGrow: 0 },
  listContent: { gap: 10 },
  card: { borderRadius: 14, padding: 12, gap: 4, minHeight: 88 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardLabel: { fontSize: 16, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  toll: { fontSize: 18, fontWeight: '800' },
  cardMain: { flexDirection: 'row', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' },
  eta: { fontSize: 28, fontWeight: '800' },
  meta: { fontSize: 15, fontWeight: '600' },
  warning: { fontSize: 14, fontWeight: '600' },
  footnote: { fontSize: 13, fontWeight: '600' },
});
