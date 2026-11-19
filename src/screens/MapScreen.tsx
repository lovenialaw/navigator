import { Camera, Map, type CameraRef } from '@maplibre/maplibre-react-native';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BigButton } from '../components/BigButton';
import { PackDrawer } from '../components/PackDrawer';
import { configResult, getPackManager } from '../offline/packManagerSingleton';
import { usePacks } from '../offline/usePacks';
import { resolveMapStyle, type ResolvedMapStyle, type ResolveNote } from '../map/styleResolver';
import { getMmkvStore } from '../storage/mmkvStore';
import { useTheme } from '../theme/theme';

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
        </Map>
      ) : null}

      <View pointerEvents="box-none" style={[styles.top, { paddingTop: insets.top + 8 }]}>
        <View style={[styles.chip, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.chipText, { color: theme.text }]}>{sourceLabel}</Text>
        </View>
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

      <View pointerEvents="box-none" style={[styles.bottom, { paddingBottom: insets.bottom + 16 }]}>
        <BigButton
          label="Offline Packs"
          variant="primary"
          onPress={() => setDrawerOpen(true)}
          accessibilityHint="Opens the regional offline map downloads"
          style={styles.fab}
        />
      </View>

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
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 12, alignItems: 'flex-end' },
  fab: { minWidth: 160, minHeight: 56 },
});
