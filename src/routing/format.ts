import { formatRinggit } from '../utils/tollCalculator';
import type { PlannedRoute } from './routeTypes';

/** "34 min", "1 h 05 min". Rounds to the nearest minute, never below 1 min. */
export function formatDuration(seconds: number): string {
  const total = Math.max(1, Math.round((Number.isFinite(seconds) ? seconds : 0) / 60));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${total} min`;
  return `${hours} h ${String(minutes).padStart(2, '0')} min`;
}

/** "850 m" under 1 km, "18.5 km" under 100 km, "142 km" beyond. */
export function formatDistance(metres: number): string {
  const m = Number.isFinite(metres) && metres > 0 ? metres : 0;
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  const km = m / 1000;
  return km < 100 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

/**
 * Distance countdown for the HUD banner, tuned for a 2-second glance: nearest 10 m under
 * 100 m, nearest 50 m under 1 km, then one decimal of km. Never shows "0 m" before arrival.
 */
export function formatCountdown(metres: number): string {
  const m = Number.isFinite(metres) && metres > 0 ? metres : 0;
  if (m < 100) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  if (m < 1000) return `${Math.round(m / 50) * 50} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

/** Local arrival time as "9:42 PM". Pure so it can be tested with a fixed clock. */
export function formatArrival(nowMs: number, durationSec: number): string {
  // Round to the nearest minute, matching formatDuration, so "1 h 07 min" and the clock agree.
  const arrival = new Date(Math.round((nowMs + Math.max(0, durationSec) * 1000) / 60_000) * 60_000);
  const hours = arrival.getHours();
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const display = hours % 12 === 0 ? 12 : hours % 12;
  return `${display}:${String(arrival.getMinutes()).padStart(2, '0')} ${suffix}`;
}

/** "No tolls" or "RM 8.40 est." The "est." is mandatory: rates are not official tariffs. */
export function formatTollLabel(route: Pick<PlannedRoute, 'toll'>): string {
  return route.toll.totalRinggit > 0 ? `${formatRinggit(route.toll.totalRinggit)} est.` : 'No tolls';
}
