import { buildConfig } from '../src/config/tujuConfig';
import { PACK_STATE_KEY, PackError, PackManager, isPmtilesHeader } from '../src/offline/packManager';
import { MemoryKeyValueStore } from '../src/storage/keyValueStore';
import { FakeFileSystem, PMTILES_BYTES } from '../test-utils/fakes';

const configured = buildConfig({ EXPO_PUBLIC_TUJU_PACK_BASE_URL: 'https://cdn.example.com/packs' });

function setup(overrides: { catalog?: typeof configured.packs } = {}) {
  const storage = new MemoryKeyValueStore();
  const fs = new FakeFileSystem();
  const create = () =>
    new PackManager({ catalog: overrides.catalog ?? configured.packs, storage, fileSystem: fs, now: () => 1234 });
  return { storage, fs, manager: create(), create };
}

const catchError = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as PackError;
  }
  throw new Error('expected rejection');
};

describe('isPmtilesHeader', () => {
  it('accepts the PMTiles magic and rejects anything else', () => {
    expect(isPmtilesHeader(PMTILES_BYTES)).toBe(true);
    expect(isPmtilesHeader(new TextEncoder().encode('<!DOCTYPE html>'))).toBe(false);
    expect(isPmtilesHeader(new Uint8Array([0x50, 0x4d]))).toBe(false);
  });
});

describe('PackManager', () => {
  it('lists the four packs as not installed on a fresh install', () => {
    const { manager } = setup();
    const list = manager.list();
    expect(list).toHaveLength(4);
    expect(list.every((p) => p.status.kind === 'not-installed' && !p.active && p.configured)).toBe(true);
  });

  it('downloads to a .part file, validates it, moves it into place and persists the record', async () => {
    const { manager, fs, storage } = setup();
    const progress: number[] = [];
    manager.subscribe(() => {
      const row = manager.list().find((p) => p.definition.id === 'klang-valley');
      if (row?.status.kind === 'downloading') progress.push(row.status.bytesWritten);
    });

    const record = await manager.download('klang-valley');

    expect(record.fileUri).toBe('file:///docs/offline-packs/klang-valley.pmtiles');
    expect(fs.exists(record.fileUri)).toBe(true);
    expect(fs.exists(`${record.fileUri}.part`)).toBe(false);
    expect(fs.directoryCreated).toBe(true);
    expect(progress).toContain(50);
    expect(manager.list().find((p) => p.definition.id === 'klang-valley')?.status).toEqual({
      kind: 'installed',
      bytes: 5000,
      downloadedAt: 1234,
    });
    expect(storage.getString(PACK_STATE_KEY)).toContain('klang-valley');
  });

  it('restores installed packs from MMKV after a restart', async () => {
    const { manager, create } = setup();
    await manager.download('sabah');
    manager.setActivePack('sabah');

    const restarted = create();
    expect(restarted.getInstalledPacks().map((p) => p.id)).toEqual(['sabah']);
    expect(restarted.getActivePack()?.id).toBe('sabah');
  });

  it('drops records whose file vanished and clears the active pack', async () => {
    const { manager, fs, create } = setup();
    const record = await manager.download('sarawak');
    manager.setActivePack('sarawak');
    fs.remove(record.fileUri);

    const restarted = create();
    expect(restarted.getInstalledPacks()).toEqual([]);
    expect(restarted.getActivePack()).toBeNull();
  });

  it('resets corrupt persisted state instead of crashing', () => {
    const { storage, create } = setup();
    storage.set(PACK_STATE_KEY, '{"installed": "nope"');
    expect(create().getInstalledPacks()).toEqual([]);
    storage.set(PACK_STATE_KEY, JSON.stringify({ installed: { x: { id: 1 } }, activePackId: null }));
    expect(create().getInstalledPacks()).toEqual([]);
  });

  it('refuses to download while the URL is still a placeholder', async () => {
    const { manager, fs } = setup({ catalog: buildConfig({}).packs });
    const error = await catchError(manager.download('klang-valley'));
    expect(error.code).toBe('not-configured');
    expect(manager.list()[0].configured).toBe(false);
    expect(fs.files.size).toBe(0);
  });

  it('refuses when free storage is below the advertised size plus margin', async () => {
    const { manager, fs } = setup();
    fs.freeBytes = 10 * 1024 * 1024;
    expect((await catchError(manager.download('klang-valley'))).code).toBe('insufficient-storage');
  });

  it('rejects an HTML error page saved as a pack and cleans up', async () => {
    const { manager, fs } = setup();
    fs.downloadImpl = async (_u, dest) => {
      fs.files.set(dest, { size: 5000, head: new TextEncoder().encode('<!DOCTYPE html>') });
    };
    const error = await catchError(manager.download('sabah'));
    expect(error.code).toBe('invalid-archive');
    expect(fs.files.size).toBe(0);
    expect(manager.list().find((p) => p.definition.id === 'sabah')).toMatchObject({
      status: { kind: 'not-installed' },
      lastError: expect.stringContaining('not a valid'),
    });
  });

  it('rejects a suspiciously tiny file', async () => {
    const { manager, fs } = setup();
    fs.downloadImpl = async (_u, dest) => {
      fs.files.set(dest, { size: 20, head: PMTILES_BYTES });
    };
    expect((await catchError(manager.download('sabah'))).code).toBe('invalid-archive');
  });

  it('reports network failures as download-failed and removes partial data', async () => {
    const { manager, fs } = setup();
    fs.downloadImpl = async (_u, dest) => {
      fs.files.set(dest, { size: 10, head: new Uint8Array() });
      throw new Error('socket closed');
    };
    const error = await catchError(manager.download('sabah'));
    expect(error.code).toBe('download-failed');
    expect(fs.files.size).toBe(0);
  });

  it('cancels an in-flight download without recording an error', async () => {
    const { manager, fs } = setup();
    fs.downloadImpl = (_u, _d, { signal }) =>
      new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    const pending = catchError(manager.download('klang-valley'));
    expect(manager.list()[0].status.kind).toBe('downloading');
    manager.cancelDownload('klang-valley');

    expect((await pending).code).toBe('cancelled');
    expect(manager.list()[0]).toMatchObject({ status: { kind: 'not-installed' }, lastError: null });
  });

  it('blocks a second concurrent download of the same pack', async () => {
    const { manager, fs } = setup();
    let release: () => void = () => {};
    fs.downloadImpl = (_u, dest) =>
      new Promise((resolve) => {
        release = () => {
          fs.files.set(dest, { size: 5000, head: PMTILES_BYTES });
          resolve();
        };
      });
    const first = manager.download('klang-valley');
    expect((await catchError(manager.download('klang-valley'))).code).toBe('already-downloading');
    release();
    await first;
    expect(manager.getInstalledPacks()).toHaveLength(1);
  });

  it('only activates installed packs, and deleting the active pack falls back to online', async () => {
    const { manager, fs } = setup();
    expect(() => manager.setActivePack('sabah')).toThrow(PackError);

    const record = await manager.download('sabah');
    manager.setActivePack('sabah');
    expect(manager.list().find((p) => p.definition.id === 'sabah')?.active).toBe(true);

    manager.remove('sabah');
    expect(fs.exists(record.fileUri)).toBe(false);
    expect(manager.getActivePack()).toBeNull();
    expect(manager.getInstalledPacks()).toEqual([]);
  });

  it('rejects unknown pack ids', async () => {
    const { manager } = setup();
    expect((await catchError(manager.download('atlantis'))).code).toBe('unknown-pack');
    expect(() => manager.remove('atlantis')).toThrow(PackError);
  });

  it('returns a referentially stable snapshot until something changes', async () => {
    const { manager } = setup();
    const a = manager.list();
    expect(manager.list()).toBe(a);
    await manager.download('sabah');
    expect(manager.list()).not.toBe(a);
  });
});
