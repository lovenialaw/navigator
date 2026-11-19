import type { PackFileSystem, DownloadProgress } from '../src/offline/packFileSystem';

export const PMTILES_BYTES = new Uint8Array([0x50, 0x4d, 0x54, 0x69, 0x6c, 0x65, 0x73, 0x03, 0, 0, 0, 0]);

interface FakeFile {
  size: number;
  head: Uint8Array;
}

export class FakeFileSystem implements PackFileSystem {
  readonly packsDirectoryUri = 'file:///docs/offline-packs/';
  files = new Map<string, FakeFile>();
  freeBytes = 10 * 1024 ** 3;
  directoryCreated = false;
  downloadImpl: (url: string, dest: string, opts: { onProgress?: (p: DownloadProgress) => void; signal?: AbortSignal }) => Promise<void> =
    async (_url, dest, opts) => {
      opts.onProgress?.({ bytesWritten: 50, totalBytes: 100 });
      this.files.set(dest, { size: 5000, head: PMTILES_BYTES });
    };

  ensurePacksDirectory() {
    this.directoryCreated = true;
  }
  exists(uri: string) {
    return this.files.has(uri);
  }
  sizeOf(uri: string) {
    return this.files.get(uri)?.size ?? 0;
  }
  remove(uri: string) {
    this.files.delete(uri);
  }
  async move(from: string, to: string) {
    const file = this.files.get(from);
    if (!file) throw new Error('missing source');
    this.files.delete(from);
    this.files.set(to, file);
  }
  async readHead(uri: string, length: number) {
    return this.files.get(uri)?.head.slice(0, length) ?? new Uint8Array();
  }
  availableDiskSpace() {
    return this.freeBytes;
  }
  download(url: string, dest: string, opts: { onProgress?: (p: DownloadProgress) => void; signal?: AbortSignal }) {
    return this.downloadImpl(url, dest, opts);
  }
}
