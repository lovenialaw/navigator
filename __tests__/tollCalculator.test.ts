import rawTolls from '../src/data/malaysiaTolls.json';
import {
  angleDiffDeg,
  bundledTollData,
  estimateTolls,
  formatRinggit,
  parseTollData,
  type LngLat,
} from '../src/utils/tollCalculator';

/** Polyline that visits the given plaza codes in order, using the bundled coordinates. */
function through(...codes: string[]): LngLat[] {
  const all = bundledTollData.highways.flatMap((h) => h.plazas);
  return codes.map((code) => {
    const plaza = all.find((p) => p.plazaCode === code);
    if (!plaza) throw new Error(`unknown plaza ${code}`);
    return [plaza.lng, plaza.lat] as const;
  });
}

describe('bundled toll data', () => {
  it('parses and covers the six requested expressways', () => {
    expect(bundledTollData.highways.length).toBeGreaterThan(0);
    const names = bundledTollData.highways.map((h) => h.shortName).sort();
    expect(names).toEqual(['AKLEH', 'DUKE', 'KESAS', 'LDP', 'MEX', 'PLUS']);
  });

  it('is flagged as placeholder data', () => {
    expect(bundledTollData.placeholder).toBe(true);
    expect(bundledTollData.currency).toBe('MYR');
    expect(bundledTollData.vehicleClass).toBe(1);
  });
});

describe('estimateTolls: open systems', () => {
  it('charges each plaza passed once', () => {
    const result = estimateTolls(through('LDP-PEN', 'LDP-PJS', 'LDP-PCB', 'LDP-PCS'));
    expect(result.charges.map((c) => c.plazaCodes[0])).toEqual(['LDP-PEN', 'LDP-PJS', 'LDP-PCB', 'LDP-PCS']);
    expect(result.totalRinggit).toBe(8.4);
    expect(result.isEstimate).toBe(true);
    expect(result.placeholderData).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it('does not double charge when the route doubles back over a plaza', () => {
    const result = estimateTolls(through('AKLEH-JDK', 'AKLEH-JDK', 'AKLEH-JDK'));
    expect(result.charges).toHaveLength(1);
    expect(result.totalRinggit).toBe(2.13);
  });

  it('sums mixed highways without floating point drift', () => {
    // LDP Penchala 2.10 + MEX Seri Kembangan 2.20 + AKLEH 2.13 = 6.43
    const result = estimateTolls(through('LDP-PEN', 'MEX-SKB', 'AKLEH-JDK'));
    expect(result.totalRinggit).toBe(6.43);
  });

  it('returns zero for a route that avoids every plaza', () => {
    const result = estimateTolls([
      [100.3, 5.4],
      [100.35, 5.45],
    ]);
    expect(result.totalRinggit).toBe(0);
    expect(result.charges).toEqual([]);
  });

  it('respects the detection radius', () => {
    const [lng, lat] = through('AKLEH-JDK')[0];
    // About 500 m east of the plaza, running north-south.
    const offset = 500 / (111_320 * Math.cos((lat * Math.PI) / 180));
    const nearMiss: LngLat[] = [
      [lng + offset, lat - 0.01],
      [lng + offset, lat + 0.01],
    ];
    expect(estimateTolls(nearMiss).totalRinggit).toBe(0);
    expect(estimateTolls(nearMiss, bundledTollData, { openRadiusM: 700 }).totalRinggit).toBe(2.13);
  });
});

describe('estimateTolls: KESAS Awan Besar direction check', () => {
  it('charges only East plaza on an eastbound trip', () => {
    const result = estimateTolls(through('KESAS-ABE', 'KESAS-ABW'));
    expect(result.charges.map((c) => c.plazaCodes[0])).toEqual(['KESAS-ABE']);
    expect(result.totalRinggit).toBe(2);
  });

  it('charges only West plaza on a westbound trip', () => {
    const result = estimateTolls(through('KESAS-ABW', 'KESAS-ABE'));
    expect(result.charges.map((c) => c.plazaCodes[0])).toEqual(['KESAS-ABW']);
    expect(result.totalRinggit).toBe(2);
  });

  it('never charges RM4.00 for both plazas on one through trip, in either direction', () => {
    expect(estimateTolls(through('KESAS-SWY', 'KESAS-ABE', 'KESAS-ABW')).totalRinggit).toBeLessThan(6);
    expect(estimateTolls(through('KESAS-ABW', 'KESAS-ABE', 'KESAS-SWY')).charges.filter((c) => c.plazaCodes[0].startsWith('KESAS-AB'))).toHaveLength(1);
  });

  it('charges neither when driving across at right angles to the carriageway', () => {
    const [lng, lat] = through('KESAS-ABE')[0];
    const northbound: LngLat[] = [
      [lng, lat - 0.01],
      [lng, lat + 0.01],
    ];
    expect(estimateTolls(northbound).totalRinggit).toBe(0);
  });

  it('leaves plazas without a chargeDirection direction-agnostic', () => {
    expect(estimateTolls(through('LDP-PCS', 'LDP-PJS')).totalRinggit).toBe(4.2);
    expect(estimateTolls(through('LDP-PJS', 'LDP-PCS')).totalRinggit).toBe(4.2);
  });
});

describe('angleDiffDeg', () => {
  it('wraps around north', () => {
    expect(angleDiffDeg(350, 10)).toBe(20);
    expect(angleDiffDeg(10, 350)).toBe(20);
    expect(angleDiffDeg(90, 270)).toBe(180);
    expect(angleDiffDeg(45, 45)).toBe(0);
  });
});

describe('estimateTolls: PLUS closed system', () => {
  it('prices entry to exit using the first and last interchange', () => {
    const result = estimateTolls(through('PLUS-RWG', 'PLUS-SBL', 'PLUS-DUT', 'PLUS-NIL'));
    expect(result.charges).toHaveLength(1);
    expect(result.charges[0]).toMatchObject({ kind: 'closed', plazaCodes: ['PLUS-RWG', 'PLUS-NIL'], rateRinggit: 9.9 });
    expect(result.totalRinggit).toBe(9.9);
  });

  it('is symmetric when driving the other way', () => {
    expect(estimateTolls(through('PLUS-SRB', 'PLUS-NIL')).totalRinggit).toBe(3.3);
    expect(estimateTolls(through('PLUS-NIL', 'PLUS-SRB')).totalRinggit).toBe(3.3);
  });

  it('adds nothing and warns when only one interchange is touched', () => {
    const result = estimateTolls(through('PLUS-DUT', 'PLUS-DUT'));
    expect(result.totalRinggit).toBe(0);
    expect(result.warnings.join(' ')).toMatch(/Jalan Duta/);
  });

  it('combines closed and open charges', () => {
    // PLUS Sungai Buloh -> Jalan Duta (1.90) then DUKE Batu plaza (2.50).
    const result = estimateTolls(through('PLUS-SBL', 'PLUS-DUT', 'DUKE-BTU'));
    expect(result.totalRinggit).toBe(4.4);
  });
});

describe('estimateTolls: bad input', () => {
  it('handles empty and single point routes', () => {
    expect(estimateTolls([]).totalRinggit).toBe(0);
    expect(estimateTolls([[101.6, 3.1]]).warnings).not.toEqual([]);
  });

  it('ignores non-finite points instead of throwing', () => {
    const route: LngLat[] = [...through('LDP-PEN'), [Number.NaN, 3], ...through('LDP-PJS')];
    const result = estimateTolls(route);
    expect(result.totalRinggit).toBe(4.2);
    expect(result.warnings.join(' ')).toMatch(/invalid/);
  });
});

describe('parseTollData', () => {
  it('strips tags from display strings', () => {
    const copy = JSON.parse(JSON.stringify(rawTolls));
    copy.highways[0].fullName = '<b>Lebuhraya</b> <script>alert(1)</script>Damansara';
    const parsed = parseTollData(copy);
    expect(parsed.highways[0].fullName).not.toMatch(/[<>]/);
  });

  it('rejects a rate that references an unknown plaza', () => {
    const copy = JSON.parse(JSON.stringify(rawTolls));
    const plus = copy.highways.find((h: { shortName: string }) => h.shortName === 'PLUS');
    plus.rates[0].to = 'PLUS-NOPE';
    expect(() => parseTollData(copy)).toThrow();
  });

  it('rejects duplicate plaza codes and negative rates', () => {
    const dup = JSON.parse(JSON.stringify(rawTolls));
    dup.highways[1].plazas[0].plazaCode = dup.highways[0].plazas[0].plazaCode;
    expect(() => parseTollData(dup)).toThrow();

    const negative = JSON.parse(JSON.stringify(rawTolls));
    negative.highways[0].plazas[0].rateClass1 = -1;
    expect(() => parseTollData(negative)).toThrow();
  });
});

describe('formatRinggit', () => {
  it('formats to two decimals', () => {
    expect(formatRinggit(4.2)).toBe('RM 4.20');
    expect(formatRinggit(0)).toBe('RM 0.00');
  });
  it('never renders NaN or negatives', () => {
    expect(formatRinggit(Number.NaN)).toBe('RM 0.00');
    expect(formatRinggit(-3)).toBe('RM 0.00');
  });
});
