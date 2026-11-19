import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatBytes, progressFraction } from '../offline/format';
import { PackError, type PackManager, type PackView } from '../offline/packManager';
import { MIN_TOUCH_TARGET, useTheme, type Theme } from '../theme/theme';
import { BigButton } from './BigButton';
import { ProgressBar } from './ProgressBar';

interface PackDrawerProps {
  visible: boolean;
  onClose: () => void;
  manager: PackManager;
  packs: PackView[];
  onUsePack: (id: string | null) => void;
}

export function PackDrawer({ visible, onClose, manager, packs, onUsePack }: PackDrawerProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const startDownload = (id: string) => {
    manager.download(id).catch((e: unknown) => {
      if (e instanceof PackError && e.code === 'cancelled') return;
      // PackManager already stored the message; it renders on the pack row.
    });
  };

  const confirmDelete = (pack: PackView) => {
    Alert.alert(`Delete ${pack.definition.name}?`, 'You can download it again later while you have a connection.', [
      { text: 'Keep', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => manager.remove(pack.definition.id) },
    ]);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <Pressable accessibilityLabel="Close offline packs" style={styles.scrim} onPress={onClose} />
        <View
          style={[
            styles.sheet,
            { backgroundColor: theme.surface, borderColor: theme.border, paddingBottom: Math.max(insets.bottom, 16) },
          ]}
        >
          <View style={styles.header}>
            <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
              Regional Offline Packs
            </Text>
            <BigButton label="Done" onPress={onClose} variant="secondary" />
          </View>
          <Text style={[styles.hint, { color: theme.textMuted }]}>
            Download a region on Wi-Fi. Its map then draws from your phone with no mobile data.
          </Text>
          <ScrollView contentContainerStyle={styles.list}>
            {packs.map((pack) => (
              <PackRow
                key={pack.definition.id}
                pack={pack}
                theme={theme}
                onDownload={() => startDownload(pack.definition.id)}
                onCancel={() => manager.cancelDownload(pack.definition.id)}
                onDelete={() => confirmDelete(pack)}
                onUse={() => onUsePack(pack.definition.id)}
                onUseOnline={() => onUsePack(null)}
              />
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

interface PackRowProps {
  pack: PackView;
  theme: Theme;
  onDownload: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onUse: () => void;
  onUseOnline: () => void;
}

function PackRow({ pack, theme, onDownload, onCancel, onDelete, onUse, onUseOnline }: PackRowProps) {
  const { definition, status } = pack;

  let statusText = `Not downloaded - about ${formatBytes(definition.approxBytes)}`;
  if (status.kind === 'downloading') {
    statusText = `Downloading ${formatBytes(status.bytesWritten)} of ${formatBytes(status.totalBytes)}`;
  } else if (status.kind === 'installed') {
    statusText = pack.active ? `On this phone - ${formatBytes(status.bytes)} - showing on map` : `On this phone - ${formatBytes(status.bytes)}`;
  } else if (!pack.configured) {
    statusText = 'Download link not configured yet';
  }

  return (
    <View style={[styles.row, { backgroundColor: theme.surfaceRaised, borderColor: pack.active ? theme.accent : theme.border }]}>
      <Text style={[styles.rowTitle, { color: theme.text }]}>{definition.name}</Text>
      <Text style={[styles.rowSub, { color: theme.textMuted }]}>{definition.description}</Text>
      <Text style={[styles.rowStatus, { color: status.kind === 'installed' ? theme.success : theme.textMuted }]}>{statusText}</Text>
      {status.kind === 'downloading' ? <ProgressBar fraction={progressFraction(status.bytesWritten, status.totalBytes)} /> : null}
      {pack.lastError ? <Text style={[styles.rowStatus, { color: theme.danger }]}>{pack.lastError}</Text> : null}

      <View style={styles.actions}>
        {status.kind === 'not-installed' ? (
          <BigButton
            label="Download"
            variant="primary"
            onPress={onDownload}
            disabled={!pack.configured}
            accessibilityHint={`Downloads the ${definition.name} offline map`}
            style={styles.action}
          />
        ) : null}
        {status.kind === 'downloading' ? <BigButton label="Cancel" variant="danger" onPress={onCancel} style={styles.action} /> : null}
        {status.kind === 'installed' ? (
          <>
            {pack.active ? (
              <BigButton label="Use online map" onPress={onUseOnline} style={styles.action} />
            ) : (
              <BigButton label="Show on map" variant="primary" onPress={onUse} style={styles.action} />
            )}
            <BigButton label="Delete" variant="danger" onPress={onDelete} style={styles.action} />
          </>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { maxHeight: '85%', borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 2, borderBottomWidth: 0, paddingTop: 16, paddingHorizontal: 16 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: MIN_TOUCH_TARGET },
  title: { fontSize: 22, fontWeight: '800', flexShrink: 1 },
  hint: { fontSize: 15, marginTop: 8, marginBottom: 12 },
  list: { gap: 12, paddingBottom: 8 },
  row: { borderWidth: 2, borderRadius: 16, padding: 14, gap: 6 },
  rowTitle: { fontSize: 19, fontWeight: '700' },
  rowSub: { fontSize: 15 },
  rowStatus: { fontSize: 15, fontWeight: '600' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 },
  action: { flexGrow: 1, flexBasis: 140 },
});
