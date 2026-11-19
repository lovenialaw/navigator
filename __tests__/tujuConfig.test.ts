import {
  DEFAULT_PACK_BASE_URL,
  DEFAULT_STYLE_URL,
  buildConfig,
  isPlaceholderUrl,
  loadConfig,
  packDefinitionSchema,
} from '../src/config/tujuConfig';

describe('tujuConfig', () => {
  it('ships the four regional packs with placeholder URLs by default', () => {
    const config = buildConfig({});
    expect(config.packs.map((p) => p.id)).toEqual(['klang-valley', 'pahang-east-coast', 'sabah', 'sarawak']);
    expect(config.styleUrl).toBe(DEFAULT_STYLE_URL);
    expect(config.packs[0].url).toBe(`${DEFAULT_PACK_BASE_URL}/klang-valley.pmtiles`);
    expect(isPlaceholderUrl(config.styleUrl)).toBe(true);
    config.packs.forEach((p) => expect(isPlaceholderUrl(p.url)).toBe(true));
  });

  it('applies style and base-url overrides, trimming trailing slashes', () => {
    const config = buildConfig({
      EXPO_PUBLIC_TUJU_STYLE_URL: ' https://cdn.example.com/style.json ',
      EXPO_PUBLIC_TUJU_PACK_BASE_URL: 'https://cdn.example.com/packs//',
      EXPO_PUBLIC_TUJU_STYLE_SOURCE_ID: 'protomaps',
    });
    expect(config.styleUrl).toBe('https://cdn.example.com/style.json');
    expect(config.styleSourceId).toBe('protomaps');
    expect(config.packs.find((p) => p.id === 'sabah')?.url).toBe('https://cdn.example.com/packs/sabah.pmtiles');
    expect(isPlaceholderUrl(config.styleUrl)).toBe(false);
  });

  it('lets a per-pack URL win over the base URL', () => {
    const config = buildConfig({
      EXPO_PUBLIC_TUJU_PACK_BASE_URL: 'https://cdn.example.com/packs',
      EXPO_PUBLIC_TUJU_PACK_URL_SARAWAK: 'https://other.example.com/sarawak-v2.pmtiles',
    });
    expect(config.packs.find((p) => p.id === 'sarawak')?.url).toBe('https://other.example.com/sarawak-v2.pmtiles');
    expect(config.packs.find((p) => p.id === 'klang-valley')?.url).toBe('https://cdn.example.com/packs/klang-valley.pmtiles');
  });

  it('treats blank overrides as unset', () => {
    expect(buildConfig({ EXPO_PUBLIC_TUJU_STYLE_URL: '   ' }).styleUrl).toBe(DEFAULT_STYLE_URL);
  });

  it('rejects non-http(s) and malformed URLs', () => {
    expect(() => buildConfig({ EXPO_PUBLIC_TUJU_STYLE_URL: 'ftp://example.com/style.json' })).toThrow();
    expect(() => buildConfig({ EXPO_PUBLIC_TUJU_PACK_URL_SABAH: 'not a url' })).toThrow();
  });

  it('loadConfig falls back to defaults and reports the error instead of throwing', () => {
    const result = loadConfig({ EXPO_PUBLIC_TUJU_STYLE_URL: 'javascript:alert(1)' });
    expect(result.error).toEqual(expect.any(String));
    expect(result.config.styleUrl).toBe(DEFAULT_STYLE_URL);
    expect(loadConfig({}).error).toBeNull();
  });

  it('keeps every pack bounding box well-formed (west < east, south < north)', () => {
    for (const pack of buildConfig({}).packs) {
      const [w, s, e, n] = pack.bounds;
      expect(w).toBeLessThan(e);
      expect(s).toBeLessThan(n);
    }
  });

  it('validates pack definitions', () => {
    const base = buildConfig({}).packs[0];
    expect(packDefinitionSchema.safeParse({ ...base, id: 'Bad Id' }).success).toBe(false);
    expect(packDefinitionSchema.safeParse({ ...base, bounds: [200, 0, 1, 1] }).success).toBe(false);
    expect(packDefinitionSchema.safeParse({ ...base, approxBytes: 0 }).success).toBe(false);
  });

  it('isPlaceholderUrl is true for unparseable input', () => {
    expect(isPlaceholderUrl('nonsense')).toBe(true);
    expect(isPlaceholderUrl('https://tiles.example.com/x')).toBe(false);
  });
});
