import { formatArrival, formatDistance, formatDuration, formatTollLabel } from '../src/routing/format';

describe('route formatting', () => {
  it('formats durations', () => {
    expect(formatDuration(0)).toBe('1 min');
    expect(formatDuration(29)).toBe('1 min');
    expect(formatDuration(34 * 60)).toBe('34 min');
    expect(formatDuration(60 * 60)).toBe('1 h 00 min');
    expect(formatDuration(65 * 60 + 20)).toBe('1 h 05 min');
    expect(formatDuration(Number.NaN)).toBe('1 min');
  });

  it('formats distances', () => {
    expect(formatDistance(0)).toBe('0 m');
    expect(formatDistance(847)).toBe('850 m');
    expect(formatDistance(18_500)).toBe('18.5 km');
    expect(formatDistance(142_400)).toBe('142 km');
    expect(formatDistance(-5)).toBe('0 m');
  });

  it('formats arrival time on a 12-hour clock', () => {
    const at = (h: number, m: number) => new Date(2026, 10, 19, h, m, 0).getTime();
    expect(formatArrival(at(21, 8), 34 * 60)).toBe('9:42 PM');
    expect(formatArrival(at(0, 10), 5 * 60)).toBe('12:15 AM');
    expect(formatArrival(at(11, 50), 20 * 60)).toBe('12:10 PM');
  });

  it('always marks a toll amount as an estimate', () => {
    const toll = (totalRinggit: number) => ({ toll: { totalRinggit, isEstimate: true as const, placeholderData: true, dataVersion: 'x', charges: [] } });
    expect(formatTollLabel(toll(8.4))).toBe('RM 8.40 est.');
    expect(formatTollLabel(toll(0))).toBe('No tolls');
  });
});
