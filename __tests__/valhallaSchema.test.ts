import fixture from './fixtures/valhalla-klcc-seremban.json';
import { normalizeValhalla } from '../src/routing/valhallaClient';
import {
  joinSignElements,
  normalizeLanes,
  valhallaResponseSchema,
} from '../src/schemas/valhallaSchema';
import { routeStepSchema } from '../src/routing/routeTypes';

/**
 * The fixture is a REAL response from valhalla1.openstreetmap.de (KLCC to Seremban),
 * captured once so these tests do not depend on the network.
 */
describe('real Valhalla response (KLCC to Seremban)', () => {
  const parsed = valhallaResponseSchema.parse(fixture);
  const raw = normalizeValhalla(parsed);

  it('validates against the schema', () => {
    expect(parsed.trip.legs).toHaveLength(1);
    expect(parsed.trip.legs[0].maneuvers).toHaveLength(20);
    expect(parsed.trip.summary.has_toll).toBe(true);
  });

  it('converts to metres and seconds', () => {
    expect(raw.distanceM).toBe(70061);
    expect(raw.durationSec).toBe(4182);
    expect(raw.hasToll).toBe(true);
    expect(raw.shape.length).toBeGreaterThan(900);
    expect(raw.shape[0][0]).toBeGreaterThan(101.6);
    expect(raw.shape[0][1]).toBeGreaterThan(3.1);
  });

  it('keeps begin and end shape indices, contiguous and inside the shape', () => {
    expect(raw.steps).toHaveLength(20);
    raw.steps.forEach((step) => {
      expect(step.endShapeIndex).toBeGreaterThanOrEqual(step.beginShapeIndex);
      expect(step.endShapeIndex).toBeLessThanOrEqual(raw.shape.length - 1);
    });
    for (let i = 1; i < raw.steps.length; i += 1) {
      expect(raw.steps[i].beginShapeIndex).toBe(raw.steps[i - 1].endShapeIndex);
    }
    expect(raw.steps[0].beginShapeIndex).toBe(0);
    expect(raw.steps[raw.steps.length - 1].endShapeIndex).toBe(raw.shape.length - 1);
  });

  it('extracts Malaysian expressway exit numbers from sign.exit_number_elements', () => {
    const exits = raw.steps.filter((s) => s.exitNumber).map((s) => s.exitNumber);
    expect(exits).toEqual(['1201B', '1202A', '218']);
    const first = raw.steps.find((s) => s.exitNumber === '1201B');
    expect(first?.exitBranch).toBe('Jalan Sultan Ismail, Jalan Bukit Bintang, Jalan Tun Razak');
  });

  it('keeps exit branch and toward text, and the toll flag', () => {
    const e2 = raw.steps.find((s) => s.streetNames.includes('E2'));
    expect(e2?.exitToward).toBe('Pandan-Tebrau');
    expect(e2?.toll).toBe(true);
    expect(raw.steps[0].toll).toBe(false);
  });

  it('has no lanes on this Malaysian route, and that is fine', () => {
    expect(raw.steps.every((s) => s.lanes.length === 0)).toBe(true);
  });

  it('every step is storable under routeStepSchema', () => {
    raw.steps.forEach((step) => expect(routeStepSchema.safeParse(step).success).toBe(true));
  });
});

describe('normalizeLanes', () => {
  it('reads string directions with a boolean active flag (the documented shape)', () => {
    expect(
      normalizeLanes([
        { directions: ['left'], active: false },
        { directions: ['through', 'slight_right'], active: true },
      ]),
    ).toEqual([
      { directions: ['left'], active: false },
      { directions: ['through', 'slight_right'], active: true },
    ]);
  });

  it('reads Valhalla bitmask directions and bitmask active/valid', () => {
    expect(normalizeLanes([{ directions: 2 | 64, active: 64 }, { directions: 8, valid: 0 }])).toEqual([
      { directions: ['through', 'right'], active: true },
      { directions: ['left'], active: false },
    ]);
  });

  it('accepts aliases and spacing variants', () => {
    expect(normalizeLanes([{ directions: ['Straight', 'slight right', 'merge-to-left', 'u-turn'], active: true }])[0].directions).toEqual([
      'through',
      'slight_right',
      'slight_left',
    ]);
  });

  it('drops garbage instead of throwing', () => {
    expect(normalizeLanes(undefined)).toEqual([]);
    expect(normalizeLanes('lanes')).toEqual([]);
    expect(normalizeLanes([null, 5, { directions: ['sideways'] }, { directions: [] }, { active: true }])).toEqual([]);
    expect(normalizeLanes(Array.from({ length: 40 }, () => ({ directions: ['through'], active: false })))).toHaveLength(12);
  });
});

describe('joinSignElements', () => {
  it('joins, de-duplicates and strips tags', () => {
    expect(joinSignElements([{ text: 'Jalan Kuching' }, { text: '<b>Jalan Tun Razak</b>' }, { text: 'Jalan Kuching' }, { text: '' }, {}])).toBe(
      'Jalan Kuching, Jalan Tun Razak',
    );
    expect(joinSignElements(undefined)).toBeUndefined();
    expect(joinSignElements([])).toBeUndefined();
  });
});

describe('maneuver field tolerance', () => {
  const base = { trip: { legs: [{ shape: '??', maneuvers: [] as unknown[] }], summary: { length: 1, time: 1 } } };

  it('survives wrong-typed optional fields', () => {
    const response = valhallaResponseSchema.parse({
      trip: {
        ...base.trip,
        legs: [
          {
            shape: '??',
            maneuvers: [
              {
                type: 'left',
                length: 'far',
                time: null,
                begin_shape_index: -3,
                end_shape_index: 'x',
                street_names: 'Jalan Ampang',
                sign: { exit_number_elements: 'nope', exit_branch_elements: [{ text: 5 }] },
                toll: 'yes',
                lanes: 'bad',
              },
            ],
          },
        ],
      },
    });
    const maneuver = response.trip.legs[0].maneuvers[0];
    expect(maneuver.type).toBe(0);
    expect(maneuver.length).toBe(0);
    expect(maneuver.begin_shape_index).toBe(0);
    expect(maneuver.street_names).toBeUndefined();
    expect(maneuver.toll).toBeUndefined();
  });

  it('still rejects a response with no legs or no summary', () => {
    expect(valhallaResponseSchema.safeParse({ trip: { legs: [], summary: { length: 1, time: 1 } } }).success).toBe(false);
    expect(valhallaResponseSchema.safeParse({ trip: { legs: base.trip.legs } }).success).toBe(false);
  });
});
