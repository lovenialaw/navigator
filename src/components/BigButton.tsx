import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';

import { MIN_TOUCH_TARGET, useTheme } from '../theme/theme';

interface BigButtonProps {
  label: string;
  onPress: () => void;
  accessibilityHint?: string;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Driving-safe button: at least 48x48dp, high-contrast, text only (never HTML). */
export function BigButton({ label, onPress, accessibilityHint, variant = 'secondary', disabled, style }: BigButtonProps) {
  const theme = useTheme();
  const palette = {
    primary: { bg: theme.accent, fg: theme.onAccent, border: theme.accent },
    secondary: { bg: theme.surfaceRaised, fg: theme.text, border: theme.border },
    danger: { bg: 'transparent', fg: theme.danger, border: theme.danger },
  }[variant];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: palette.bg, borderColor: palette.border, opacity: disabled ? 0.45 : pressed ? 0.75 : 1 },
        style,
      ]}
    >
      <Text style={[styles.label, { color: palette.fg }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: MIN_TOUCH_TARGET,
    minWidth: MIN_TOUCH_TARGET,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 17, fontWeight: '700' },
});
