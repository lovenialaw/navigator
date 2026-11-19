/**
 * Malaysian road sign styling: expressways use green signs, federal and municipal roads
 * use blue. Decided from the road names/refs Valhalla returns (e.g. "E12", "Lebuhraya
 * Utara-Selatan", "Jalan Tun Razak") and from expressway exit numbers.
 */

export type RoadKind = 'expressway' | 'federal';

/** Banner colours. Both keep white text above WCAG AA contrast. */
export const ROAD_SIGN_COLORS: Record<RoadKind, string> = {
  expressway: '#006B3F',
  federal: '#003DA5',
};

const EXPRESSWAY_NAME =
  /\b(PLUS|LDP|KESAS|MEX|DUKE|AKLEH|ELITE|NKVE|NPE|SPE|GCE|LPT2?|ECE|SILK|KLK|SKVE|SMART|Lebuhraya|Expressway|Terowong)\b/i;
/** "Lebuhraya Persekutuan" (Federal Highway) is a federal road despite the word Lebuhraya. */
const FEDERAL_NAME = /\b(Persekutuan|Federal)\b/i;
/** E-routes (E1, E12) and Asian Highway numbers (AH2) are expressways. */
const EXPRESSWAY_REF = /^(E|AH)\s?-?\d{1,3}[A-Z]?$/i;
/** A route reference rather than a street name: E12, 241, AH2, FT1. */
const ANY_REF = /^[A-Z]{0,3}\s?-?\d{1,4}[A-Z]?$/i;

export function isRoadRef(name: string): boolean {
  return ANY_REF.test(name.trim());
}

function isExpresswayName(name: string): boolean {
  const trimmed = name.trim();
  if (FEDERAL_NAME.test(trimmed)) return false;
  return EXPRESSWAY_REF.test(trimmed) || EXPRESSWAY_NAME.test(trimmed);
}

/**
 * Green when any of the names is an expressway or the sign carries an exit number
 * (those only exist on expressways); blue otherwise.
 */
export function classifyRoad(names: readonly string[], exitNumber?: string): RoadKind {
  if (exitNumber && exitNumber.trim().length > 0) return 'expressway';
  return names.some(isExpresswayName) ? 'expressway' : 'federal';
}
