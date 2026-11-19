import { useColorScheme } from 'react-native';

/** Minimum touch target on both axes, in dp (driving safety rule). */
export const MIN_TOUCH_TARGET = 48;

export interface Theme {
  dark: boolean;
  background: string;
  surface: string;
  surfaceRaised: string;
  border: string;
  text: string;
  textMuted: string;
  accent: string;
  onAccent: string;
  danger: string;
  success: string;
  warning: string;
}

export const darkTheme: Theme = {
  dark: true,
  background: '#0B0F14',
  surface: '#141A22',
  surfaceRaised: '#1D2631',
  border: '#3A4756',
  text: '#FFFFFF',
  textMuted: '#B6C2D0',
  accent: '#FFC400',
  onAccent: '#000000',
  danger: '#FF6B6B',
  success: '#4ADE80',
  warning: '#FFC400',
};

export const lightTheme: Theme = {
  dark: false,
  background: '#FFFFFF',
  surface: '#F4F6F8',
  surfaceRaised: '#FFFFFF',
  border: '#5B6775',
  text: '#0B0F14',
  textMuted: '#33404D',
  accent: '#B45309',
  onAccent: '#FFFFFF',
  danger: '#B42318',
  success: '#166534',
  warning: '#92400E',
};

export function useTheme(): Theme {
  return useColorScheme() === 'light' ? lightTheme : darkTheme;
}
