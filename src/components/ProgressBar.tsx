import { StyleSheet, View } from 'react-native';

import { useTheme } from '../theme/theme';

export function ProgressBar({ fraction }: { fraction: number }) {
  const theme = useTheme();
  const pct = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0)) * 100;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct) }}
      style={[styles.track, { backgroundColor: theme.border }]}
    >
      <View style={[styles.fill, { width: `${pct}%`, backgroundColor: theme.accent }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: 8 },
});
