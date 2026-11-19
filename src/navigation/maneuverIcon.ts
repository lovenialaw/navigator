import type { LaneDirection } from '../routing/routeTypes';

export interface ManeuverIcon {
  glyph: string;
  /** Degrees clockwise to rotate the glyph. */
  rotationDeg: number;
}

const UP = '↑';

/** Rotation of the up-arrow for each lane direction. */
export const LANE_ROTATION: Record<LaneDirection, number> = {
  through: 0,
  slight_right: 45,
  right: 90,
  sharp_right: 135,
  reverse: 180,
  sharp_left: -135,
  left: -90,
  slight_left: -45,
};

/**
 * Valhalla maneuver `type` to an arrow.
 * 1-3 start, 4-6 destination, 7 becomes, 8 continue, 9 slight right, 10 right, 11 sharp
 * right, 12/13 u-turn, 14 sharp left, 15 left, 16 slight left, 17-19 ramp, 20/21 exit,
 * 22-24 stay straight/right/left, 25 merge, 26/27 roundabout, 28/29 ferry, 37/38 merge R/L.
 */
export function maneuverIcon(type: number): ManeuverIcon {
  switch (type) {
    case 4:
    case 5:
    case 6:
      return { glyph: '🏁', rotationDeg: 0 };
    case 9:
      return { glyph: UP, rotationDeg: 45 };
    case 10:
      return { glyph: UP, rotationDeg: 90 };
    case 11:
      return { glyph: UP, rotationDeg: 135 };
    case 12:
      return { glyph: '↷', rotationDeg: 0 };
    case 13:
      return { glyph: '↶', rotationDeg: 0 };
    case 14:
      return { glyph: UP, rotationDeg: -135 };
    case 15:
      return { glyph: UP, rotationDeg: -90 };
    case 16:
      return { glyph: UP, rotationDeg: -45 };
    case 18:
    case 20:
      return { glyph: UP, rotationDeg: 45 };
    case 19:
    case 21:
      return { glyph: UP, rotationDeg: -45 };
    case 23:
    case 37:
      return { glyph: UP, rotationDeg: 20 };
    case 24:
    case 38:
      return { glyph: UP, rotationDeg: -20 };
    case 26:
    case 27:
      return { glyph: '↻', rotationDeg: 0 };
    default:
      return { glyph: UP, rotationDeg: 0 };
  }
}
