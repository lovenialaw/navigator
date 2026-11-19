import { Camera, GeoJSONSource, Layer, Map, type CameraRef } from '@maplibre/maplibre-react-native';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isPlaceholderUrl } from '../config/tujuConfig';
import { BigButton } from '../components/BigButton';
import { DestinationSearch } from '../components/DestinationSearch';
import { AlongRoutePanel } from '../components/AlongRoutePanel';
import { NavigationHUD } from '../components/NavigationHUD';
import { PackDrawer } from '../components/PackDrawer';
import { RouteSheet } from '../components/RouteSheet';
import { configResult, getPackManager } from '../offline/packManagerSingleton';
import { usePacks } from '../offline/usePacks';
import { resolveMapStyle, type ResolvedMapStyle, type ResolveNote } from '../map/styleResolver';
import { useNavigation } from '../navigation/useNavigation';
import { locateAlerts, locatePois } from '../poi/alongRoute';
import { POI_KIND_LABEL, type RoutePoi } from '../poi/poiTypes';
import { useRouteCompanion } from '../poi/useRouteCompanion';
import { formatDuration, formatTollLabel } from '../routing/format';
import { useRoutePlanner } from '../routing/useRoutePlanner';
import { usePlaceSearch } from '../search/usePlaceSearch';
import { getMmkvStore } from '../storage/mmkvStore';
import { useTheme } from '../theme/theme';
import { boundsOf } from '../utils/geo';
import { buildRouteGeometry } from '../utils/mapMatcher';

type MapStyleProp = ComponentProps<typeof Map>['mapStyle'];

const MALAYSIA_CENTER: [number, number] = [109.7, 4.2];
const MALAYSIA_ZOOM = 4.6;

const NOTE_TEXT: Record<ResolveNote, string> = {
  'style-not-configured': 'Map style URL is not configured. Showing a blank map. See docs/offline-maps.md.',
  'style-unavailable': 'Could not load the map style. Connect once, then try again.',
  'pack-not-applicable': 'This style has no vector source to swap for the offline pack.',
};

export function MapScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const manager = getPackManager();
  const packs = usePacks(manager);
  const cameraRef = useRef<CameraRef>(null);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [resolved, setResolved] = useState<ResolvedMapStyle | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const { config } = configResult;
  const activePack = packs.find((p) => p.active) ?? null;
  const activeFileUri = manager.getActivePack()?.fileUri ?? null;
  const installed = packs.filter((p) => p.status.kind === 'installed');

  const planner = useRoutePlanner(getMmkvStore(), config.valhallaBaseUrl);
  const search = usePlaceSearch({ baseUrl: config.photonBaseUrl });
  const demoMode = isPlaceholderUrl(config.valhallaBaseUrl) || isPlaceholderUrl(config.photonBaseUrl);
  const active = planner.active;
  const nav = useNavigation({
    store: getMmkvStore(),
    route: active,
    valhallaBaseUrl: config.valhallaBaseUrl,
    cache: planner.cache,
    onRouteReplaced: planner.replaceRoute,
  });
  const navigating = nav.navigating && nav.hud !== null;

  // "Along Your Route": POIs and alerts are fetched only while driving, then placed on the route.
  const companion = useRouteCompanion({
    store: getMmkvStore(),
    route: active,
    enabled: navigating,
    overpassUrl: config.overpassUrl,
    alertsUrl: config.alertsUrl,
  });
  const routeGeometry = useMemo(() => (active ? buildRouteGeometry(active.shape, active.steps) : null), [active]);
  const routePois = useMemo(
    () => (routeGeometry ? locatePois(routeGeometry, companion.pois) : []),
    [routeGeometry, companion.pois],
  );
  const routeAlerts = useMemo(
    () => (routeGeometry ? locateAlerts(routeGeometry, companion.alerts) : []),
    [routeGeometry, companion.alerts],
  );
  const stopIds = useMemo(() => (active?.waypoints ?? []).map((w) => w.id), [active]);

  const toggleStop = useCallback(
    (poi: RoutePoi) => {
      if (stopIds.includes(poi.id)) {
        nav.removeStop(poi.id);
        return;
      }
      nav.addStop({ id: poi.id, name: poi.name, subtitle: POI_KIND_LABEL[poi.kind], lng: poi.lng, lat: poi.lat });
    },
    [nav, stopIds],
  );

  const startNavigation = useCallback(() => {
    planner.closeSheet();
    nav.start();
  }, [planner, nav]);

  const endNavigation = useCallback(() => {
    nav.stop();
    planner.clear();
  }, [planner, nav]);

  const pickDestination = useCallback(
    (place: Parameters<typeof planner.planTo>[0]) => {
      search.reset();
      planner.planTo(place);
    },
    [planner, search],
  );

  const routeFeatures = useMemo(() => {
    if (!active) return null;
    const line = (shape: readonly (readonly [number, number])[]): GeoJSON.Feature<GeoJSON.LineString> => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: shape.map(([lng, lat]) => [lng, lat]) },
    });
    return {
      selected: line(active.shape),
      alternates: {
        type: 'FeatureCollection' as const,
        features: planner.routes.filter((r) => r.id !== active.id).map((r) => line(r.shape)),
      },
      destination: {
        type: 'Feature' as const,
        properties: {},
        geometry: { type: 'Point' as const, coordinates: [active.destination.lng, active.destination.lat] },
      },
      stops: {
        type: 'FeatureCollection' as const,
        features: active.waypoints.map((w) => ({
          type: 'Feature' as const,
          properties: {},
          geometry: { type: 'Point' as const, coordinates: [w.lng, w.lat] },
        })),
      },
    };
  }, [active, planner.routes]);

  const activeRouteId = active?.id;
  const activeShape = active?.shape;
  useEffect(() => {
    const bounds = boundsOf(activeShape ?? []);
    // While driving the camera follows the puck instead (below), also after a re-route.
    if (!bounds || !resolved || nav.navigating) return;
    cameraRef.current?.fitBounds(bounds, { padding: { top: 150, right: 40, bottom: 360, left: 40 }, duration: 800 });
    // Refit only when the chosen route (or map readiness) changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRouteId, resolved]);

  // Follow the snapped puck, heading-up, with the road ahead filling the screen.
  const puck = nav.position;
  useEffect(() => {
    if (!navigating || !puck || !resolved) return;
    cameraRef.current?.easeTo({
      center: [puck.lng, puck.lat],
      zoom: 16.5,
      pitch: 45,
      ...(puck.bearingDeg !== null ? { bearing: puck.bearingDeg } : {}),
      padding: { top: 240, right: 0, bottom: 110, left: 0 },
      duration: 900,
    });
  }, [navigating, puck, resolved]);

  const puckFeature = useMemo(
    () =>
      puck
        ? {
            type: 'Feature' as const,
            properties: {},
            geometry: { type: 'Point' as const, coordinates: [puck.lng, puck.lat] },
          }
        : null,
    [puck],
  );

  useEffect(() => {
    let cancelled = false;
    setLoadFailed(false);
    resolveMapStyle({
      styleUrl: config.styleUrl,
      styleSourceId: config.styleSourceId,
      activePackFileUri: activeFileUri,
      fetch,
      storage: getMmkvStore(),
    }).then((result) => {
      if (!cancelled) setResolved(result);
    });
    return () => {
      cancelled = true;
    };
  }, [config.styleUrl, config.styleSourceId, activeFileUri]);

  const selectPack = useCallback(
    (id: string | null) => {
      manager.setActivePack(id);
      const definition = id ? packs.find((p) => p.definition.id === id)?.definition : null;
      if (definition) {
        setDrawerOpen(false);
        cameraRef.current?.fitBounds(definition.bounds, { padding: { top: 80, right: 40, bottom: 140, left: 40 }, duration: 800 });
      }
    },
    [manager, packs],
  );

  const banner = useMemo(() => {
    if (configResult.error) return 'A TUJU config override was invalid, so defaults are in use.';
    if (resolved?.note) return NOTE_TEXT[resolved.note];
    return null;
  }, [resolved]);

  const sourceLabel = activePack ? `Offline: ${activePack.definition.name}` : 'Online map';

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <StatusBar style={theme.dark ? 'light' : 'dark'} />
      {resolved ? (
        <Map
          style={StyleSheet.absoluteFill}
          mapStyle={resolved.mapStyle as MapStyleProp}
          onDidFailLoadingMap={() => setLoadFailed(true)}
          onDidFinishLoadingMap={() => setLoadFailed(false)}
        >
          <Camera ref={cameraRef} initialViewState={{ center: MALAYSIA_CENTER, zoom: MALAYSIA_ZOOM }} />
          {routeFeatures && !navigating && routeFeatures.alternates.features.length > 0 ? (
            <GeoJSONSource id="route-alternates" data={routeFeatures.alternates}>
              <Layer
                id="route-alternates-line"
                type="line"
                layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                paint={{ 'line-color': '#8FA3B8', 'line-width': 6, 'line-opacity': 0.75 }}
              />
            </GeoJSONSource>
          ) : null}
          {routeFeatures ? (
            <GeoJSONSource id="route-selected" data={routeFeatures.selected}>
              <Layer
                id="route-selected-casing"
                type="line"
                layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                paint={{ 'line-color': '#00252B', 'line-width': 11 }}
              />
              <Layer
                id="route-selected-line"
                type="line"
                layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                paint={{ 'line-color': '#00E5FF', 'line-width': 7 }}
              />
            </GeoJSONSource>
          ) : null}
          {routeFeatures ? (
            <GeoJSONSource id="route-destination" data={routeFeatures.destination}>
              <Layer
                id="route-destination-dot"
                type="circle"
                paint={{ 'circle-radius': 9, 'circle-color': '#FFC400', 'circle-stroke-color': '#000000', 'circle-stroke-width': 3 }}
              />
            </GeoJSONSource>
          ) : null}
          {routeFeatures && routeFeatures.stops.features.length > 0 ? (
            <GeoJSONSource id="route-stops" data={routeFeatures.stops}>
              <Layer
                id="route-stops-dot"
                type="circle"
                paint={{ 'circle-radius': 9, 'circle-color': '#FFFFFF', 'circle-stroke-color': '#00E5FF', 'circle-stroke-width': 4 }}
              />
            </GeoJSONSource>
          ) : null}
          {navigating && puckFeature ? (
            <GeoJSONSource id="nav-puck" data={puckFeature}>
              <Layer
                id="nav-puck-halo"
                type="circle"
                paint={{ 'circle-radius': 20, 'circle-color': '#00E5FF', 'circle-opacity': 0.25 }}
              />
              <Layer
                id="nav-puck-dot"
                type="circle"
                paint={{ 'circle-radius': 10, 'circle-color': '#00E5FF', 'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 3 }}
              />
            </GeoJSONSource>
          ) : null}
        </Map>
      ) : null}

      {navigating && nav.hud ? (
        <NavigationHUD hud={nav.hud} notice={nav.notice} gpsLost={nav.gpsLost} onEndRoute={endNavigation} />
      ) : null}
      {navigating && nav.hud && !nav.hud.arrived ? (
        <AlongRoutePanel
          pois={routePois}
          alerts={routeAlerts}
          alongM={nav.alongM}
          poiStatus={companion.poiStatus}
          alertStatus={companion.alertStatus}
          stopIds={stopIds}
          onToggleStop={toggleStop}
        />
      ) : null}

      {!navigating ? (
      <View pointerEvents="box-none" style={[styles.top, { paddingTop: insets.top + 8 }]}>
        <DestinationSearch search={search} onPick={pickDestination} />
        <View style={[styles.chip, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.chipText, { color: theme.text }]}>{sourceLabel}</Text>
        </View>
        {demoMode ? (
          <View style={[styles.chip, { backgroundColor: theme.surface, borderColor: theme.warning }]}>
            <Text style={[styles.chipText, { color: theme.warning }]}>Demo data: no search or routing server</Text>
          </View>
        ) : null}
        {banner ? (
          <View style={[styles.banner, { backgroundColor: theme.surface, borderColor: theme.warning }]}>
            <Text style={[styles.bannerText, { color: theme.text }]}>{banner}</Text>
          </View>
        ) : null}
        {loadFailed && !activePack && installed.length > 0 ? (
          <View style={[styles.banner, { backgroundColor: theme.surface, borderColor: theme.warning }]}>
            <Text style={[styles.bannerText, { color: theme.text }]}>Map not loading. Switch to a downloaded pack?</Text>
            <BigButton label={`Use ${installed[0].definition.name}`} variant="primary" onPress={() => selectPack(installed[0].definition.id)} />
          </View>
        ) : null}
      </View>
      ) : null}

      {!planner.sheetOpen && !navigating ? (
        <View pointerEvents="box-none" style={[styles.bottom, { paddingBottom: insets.bottom + 16 }]}>
          {active ? (
            <View style={[styles.routeChip, { backgroundColor: theme.surface, borderColor: theme.accent }]}>
              <Text style={[styles.routeChipText, { color: theme.text }]} numberOfLines={2}>
                To {active.destination.name}: {formatDuration(active.durationSec)}, {formatTollLabel(active)}
              </Text>
              <View style={styles.routeChipButtons}>
                <BigButton label="Start" variant="primary" onPress={startNavigation} style={styles.chipButton} />
                <BigButton label="Routes" onPress={planner.openSheet} style={styles.chipButton} />
                <BigButton label="Clear" variant="danger" onPress={planner.clear} style={styles.chipButton} />
              </View>
            </View>
          ) : null}
          <BigButton
            label="Offline Packs"
            variant="primary"
            onPress={() => setDrawerOpen(true)}
            accessibilityHint="Opens the regional offline map downloads"
            style={styles.fab}
          />
        </View>
      ) : null}

      {!navigating ? <RouteSheet planner={planner} onStart={startNavigation} /> : null}

      <PackDrawer visible={drawerOpen} onClose={() => setDrawerOpen(false)} manager={manager} packs={packs} onUsePack={selectPack} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 12, gap: 8, alignItems: 'flex-start' },
  chip: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 24, borderWidth: 2 },
  chipText: { fontSize: 16, fontWeight: '700' },
  banner: { borderWidth: 2, borderRadius: 14, padding: 12, gap: 10, alignSelf: 'stretch' },
  bannerText: { fontSize: 15, fontWeight: '600' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 12, alignItems: 'flex-end', gap: 10 },
  fab: { minWidth: 160, minHeight: 56 },
  routeChip: { alignSelf: 'stretch', borderWidth: 3, borderRadius: 14, padding: 12, gap: 10 },
  routeChipText: { fontSize: 16, fontWeight: '700' },
  routeChipButtons: { flexDirection: 'row', gap: 10 },
  chipButton: { flex: 1 },
});
