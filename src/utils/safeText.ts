import { z } from 'zod';

/**
 * Anything that came from the network (Photon names, Valhalla instructions) goes
 * through here before it can reach a <Text>. React Native does not render HTML, but
 * stray tags and control characters still look broken to a driver.
 */
export function sanitizeText(value: unknown, maxLength = 160): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:#\d+|#x[0-9a-f]+|[a-z]+);/gi, ' ')
    .replace(/[<>]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

/** Zod string that sanitises instead of rejecting; empty input becomes "". */
export function safeText(maxLength = 160) {
  return z.unknown().transform((value) => sanitizeText(value, maxLength));
}

/** Like `safeText` but an unusable value becomes `undefined` rather than "". */
export function optionalSafeText(maxLength = 160) {
  return z
    .unknown()
    .transform((value) => sanitizeText(value, maxLength) || undefined);
}
