/**
 * Turns "where am I on the route" into what the HUD shows. Pure functions only: the
 * hook feeds in the matcher state, the HUD renders the returned model.
 */
import { formatArrival, formatCountdown, formatDistance, formatDuration } from '../routing/format';
import type { Lane, PlannedRoute, RouteStep } from '../routing/routeTypes';
import { formatRinggit } from '../utils/tollCalculator';
import type { MatchState, RouteGeometry } from '../utils/mapMatcher';
import { stepIndexAtSegment } from '../utils/mapMatcher';
import { maneuverIcon } from './maneuverIcon';
import { classifyRoad, isRoadRef, type RoadKind } from './roadSign';

/** Within this distance of the end of the route the trip counts as arrived. */
export const ARRIVE_RADIUS_M = 30;

export interface GuidanceProgress {
  /** Maneuver currently being driven. */
  stepIndex: number;
  /** Upcoming maneuver shown in the banner, or null on the final stretch. */
  nextStepIndex: number | null;
  distanceToNextM: number;
  remainingDistanceM: number;
  remainingDurationSec: number;
  /** RM still to pay, from tolls whose plaza is ahead of the vehicle. */
  tollAheadRinggit: number;
  arrived: boolean;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export function computeProgress(route: PlannedRoute, geometry: RouteGeometry, state: MatchState): GuidanceProgress {
  const total = geometry.totalM;
  const along = Math.min(Math.max(state.alongM, 0), total);
  const remainingM = Math.max(0, total - along);
  const lastIndex = geometry.cumulativeM.length - 1;
  const at = (shapeIndex: number) => geometry.cumulativeM[Math.min(Math.max(shapeIndex, 0), lastIndex)];

  const steps = route.steps;
  const stepIndex = steps.length > 0 ? stepIndexAtSegment(geometry, state.segmentIndex) : 0;
  const nextStepIndex = stepIndex + 1 < steps.length ? stepIndex + 1 : null;
  const distanceToNextM =
    nextStepIndex === null ? remainingM : Math.max(0, at(steps[nextStepIndex].beginShapeIndex) - along);

  // Valhalla's own length is the number drivers compare against, so scale our geometry to it.
  const scale = total > 0 && route.distanceM > 0 ? route.distanceM / total : 1;

  let remainingDurationSec = 0;
  const current = steps[stepIndex];
  if (current) {
    const span = at(current.endShapeIndex) - at(current.beginShapeIndex);
    const done = span > 0 ? clamp01((along - at(current.beginShapeIndex)) / span) : 1;
    remainingDurationSec = current.durationSec * (1 - done);
    for (let j = stepIndex + 1; j < steps.length; j += 1) remainingDurationSec += steps[j].durationSec;
  }
  if (!(remainingDurationSec > 0)) {
    remainingDurationSec = total > 0 ? route.durationSec * (remainingM / total) : 0;
  }

  let tollAheadSen = 0;
  for (const charge of route.toll.charges) {
    if (charge.alongM > along) tollAheadSen += Math.round(charge.rateRinggit * 100);
  }

  return {
    stepIndex,
    nextStepIndex,
    distanceToNextM,
    remainingDistanceM: remainingM * scale,
    remainingDurationSec,
    tollAheadRinggit: tollAheadSen / 100,
    arrived: remainingM <= ARRIVE_RADIUS_M,
  };
}

// ---------------------------------------------------------------------------
// HUD model
// ---------------------------------------------------------------------------

export interface HudBanner {
  kind: RoadKind;
  glyph: string;
  rotationDeg: number;
  distanceText: string;
  /** Street (or ramp destination) the next maneuver leads to. */
  primary: string;
  /** Route refs such as "E12" shown as small badges beside the street name. */
  badges: string[];
  /** "EXIT 1107" or null. */
  exitLabel: string | null;
  toward: string | null;
}

export interface HudBottom {
  arrivalText: string;
  remainingDurationText: string;
  remainingDistanceText: string;
  tollText: string;
  hasTollAhead: boolean;
}

export interface HudModel {
  banner: HudBanner;
  lanes: Lane[];
  bottom: HudBottom;
  arrived: boolean;
}

function streetLabel(step: RouteStep): string {
  const street = step.streetNames.find((name) => !isRoadRef(name));
  return street ?? step.exitBranch ?? step.exitToward ?? step.streetNames[0] ?? step.instruction;
}

export function buildHudModel(route: PlannedRoute, progress: GuidanceProgress, nowMs: number): HudModel {
  const current = route.steps[progress.stepIndex];
  const next = progress.nextStepIndex !== null ? route.steps[progress.nextStepIndex] : undefined;
  const target = next ?? current;

  const bottom: HudBottom = {
    arrivalText: formatArrival(nowMs, progress.remainingDurationSec),
    remainingDurationText: formatDuration(progress.remainingDurationSec),
    remainingDistanceText: formatDistance(progress.remainingDistanceM),
    hasTollAhead: progress.tollAheadRinggit > 0,
    tollText: progress.tollAheadRinggit > 0 ? `${formatRinggit(progress.tollAheadRinggit)} est. tolls ahead` : 'No tolls ahead',
  };

  if (progress.arrived || !target) {
    return {
      banner: {
        kind: 'federal',
        glyph: maneuverIcon(4).glyph,
        rotationDeg: 0,
        distanceText: '',
        primary: `You have arrived at ${route.destination.name}`,
        badges: [],
        exitLabel: null,
        toward: null,
      },
      lanes: [],
      bottom,
      arrived: true,
    };
  }

  const icon = maneuverIcon(target.type);
  const kind = classifyRoad([...target.streetNames, ...(current?.streetNames ?? [])], target.exitNumber);

  return {
    banner: {
      kind,
      glyph: icon.glyph,
      rotationDeg: icon.rotationDeg,
      distanceText: formatCountdown(progress.distanceToNextM),
      primary: streetLabel(target),
      badges: target.streetNames.filter(isRoadRef).slice(0, 2),
      exitLabel: target.exitNumber ? `EXIT ${target.exitNumber}` : null,
      toward: target.exitToward ?? null,
    },
    lanes: target.lanes,
    bottom,
    arrived: false,
  };
}
