import { formatBytes, progressFraction } from '../src/offline/format';

describe('format', () => {
  it('formats sizes', () => {
    expect(formatBytes(0)).toBe('0 MB');
    expect(formatBytes(180 * 1024 * 1024)).toBe('180 MB');
    expect(formatBytes(1.5 * 1024 ** 3)).toBe('1.5 GB');
  });
  it('clamps progress', () => {
    expect(progressFraction(50, 100)).toBe(0.5);
    expect(progressFraction(500, 100)).toBe(1);
    expect(progressFraction(1, 0)).toBe(0);
  });
});
