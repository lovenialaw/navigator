import { LocationManager } from '@maplibre/maplibre-react-native';

export interface Origin {
  lng: number;
  lat: number;
  source: 'gps' | 'fallback';
}

/** KLCC. Used when location is denied or unavailable so planning still works as a guest. */
export const FALLBACK_ORIGIN: Origin = { lng: 101.7116, lat: 3.1579, source: 'fallback' };

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Best-effort device position. Never throws and never blocks for long: a driver with
 * no GPS fix still gets routes, from the fallback origin, and the UI says so.
 */
export async function getOrigin(timeoutMs = 4000): Promise<Origin> {
  try {
    const granted = await withTimeout(LocationManager.requestPermissions(), 15_000);
    if (!granted) return FALLBACK_ORIGIN;
    const position = await withTimeout(LocationManager.getCurrentPosition(), timeoutMs);
    if (!position) return FALLBACK_ORIGIN;
    const { longitude, latitude } = position.coords;
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return FALLBACK_ORIGIN;
    return { lng: longitude, lat: latitude, source: 'gps' };
  } catch {
    return FALLBACK_ORIGIN;
  }
}
