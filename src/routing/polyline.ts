import type { LngLat } from '../utils/tollCalculator';

/**
 * Decodes an encoded polyline into [lng, lat] points.
 *
 * Valhalla encodes at precision 6 (1e-6 degrees) and in lat,lng order; the rest of
 * the app uses GeoJSON order, so the pair is flipped here. Throws on malformed input
 * so a corrupt route is rejected instead of drawing garbage.
 */
export function decodePolyline(encoded: string, precision = 6): LngLat[] {
  const factor = 10 ** precision;
  const points: LngLat[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  const readValue = (): number => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      if (index >= encoded.length) throw new Error('polyline: truncated input');
      byte = encoded.charCodeAt(index) - 63;
      index += 1;
      if (byte < 0 || byte > 63) throw new Error('polyline: invalid character');
      if (shift > 30) throw new Error('polyline: value too large');
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };

  while (index < encoded.length) {
    lat += readValue();
    lng += readValue();
    const point: LngLat = [lng / factor, lat / factor];
    if (Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90) throw new Error('polyline: coordinate out of range');
    points.push(point);
  }
  return points;
}

/** Test and mock helper: the inverse of `decodePolyline` for [lng, lat] points. */
export function encodePolyline(points: readonly LngLat[], precision = 6): string {
  const factor = 10 ** precision;
  let prevLat = 0;
  let prevLng = 0;
  let out = '';

  const writeValue = (delta: number) => {
    let value = delta < 0 ? ~(delta << 1) : delta << 1;
    while (value >= 0x20) {
      out += String.fromCharCode((0x20 | (value & 0x1f)) + 63);
      value >>= 5;
    }
    out += String.fromCharCode(value + 63);
  };

  for (const [lng, lat] of points) {
    const latE = Math.round(lat * factor);
    const lngE = Math.round(lng * factor);
    writeValue(latE - prevLat);
    writeValue(lngE - prevLng);
    prevLat = latE;
    prevLng = lngE;
  }
  return out;
}
