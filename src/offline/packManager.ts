import { z } from 'zod';

import { isPlaceholderUrl, type PackDefinition } from '../config/tujuConfig';
import type { KeyValueStore } from '../storage/keyValueStore';
import type { PackFileSystem } from './packFileSystem';

export const PACK_STATE_KEY = 'tuju.offlinePacks.v1';

const installedPackSchema = z.object({
  id: z.string(),
  fileUri: z.string(),
  bytes: z.number().int().nonnegative(),
  sourceUrl: z.string(),
  downloadedAt: z.number(),
});
export type InstalledPack = z.infer<typeof installedPackSchema>;

const persistedStateSchema = z.object({
  installed: z.record(z.string(), installedPackSchema),
  activePackId: z.string().nullable(),
});
type PersistedState = z.infer<typeof persistedStateSchema>;

const EMPTY_STATE: PersistedState = { installed: {}, activePackId: null };

/** Disk-space check keeps a safety margin over the advertised size. */
export const DISK_SPACE_MARGIN = 1.1;
/** Anything smaller than this cannot be a real vector archive (header alone is 127 bytes). */
export const MIN_PACK_BYTES = 1024;
const PMTILES_MAGIC = [0x50, 0x4d, 0x54, 0x69, 0x6c, 0x65, 0x73]; // "PMTiles"

export type PackErrorCode =
  | 'not-configured'
  | 'unknown-pack'
  | 'already-downloading'
  | 'insufficient-storage'
  | 'invalid-archive'
  | 'cancelled'
  | 'download-failed';

export class PackError extends Error {
  constructor(
    readonly code: PackErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PackError';
  }
}

export function isPmtilesHeader(bytes: Uint8Array): boolean {
  return bytes.length >= PMTILES_MAGIC.length && PMTILES_MAGIC.every((b, i) => bytes[i] === b);
}

export type PackStatus =
  | { kind: 'not-installed' }
  | { kind: 'downloading'; bytesWritten: number; totalBytes: number }
  | { kind: 'installed'; bytes: number; downloadedAt: number };

export interface PackView {
  definition: PackDefinition;
  status: PackStatus;
  /** URL still points at the placeholder host, so downloading is blocked. */
  configured: boolean;
  active: boolean;
  lastError: string | null;
}

export interface PackManagerOptions {
  catalog: PackDefinition[];
  storage: KeyValueStore;
  fileSystem: PackFileSystem;
  now?: () => number;
}

interface ActiveDownload {
  controller: AbortController;
  progress: { bytesWritten: number; totalBytes: number };
}

export class PackManager {
  private readonly catalog: PackDefinition[];
  private readonly storage: KeyValueStore;
  private readonly fs: PackFileSystem;
  private readonly now: () => number;
  private readonly downloads = new Map<string, ActiveDownload>();
  private readonly errors = new Map<string, string>();
  private readonly listeners = new Set<() => void>();
  private state: PersistedState;
  private snapshot: PackView[] | null = null;

  constructor({ catalog, storage, fileSystem, now = Date.now }: PackManagerOptions) {
    this.catalog = catalog;
    this.storage = storage;
    this.fs = fileSystem;
    this.now = now;
    this.state = this.readState();
    this.reconcile();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Referentially stable between changes, so it works as a `useSyncExternalStore` snapshot. */
  list(): PackView[] {
    if (!this.snapshot) {
      this.snapshot = this.catalog.map((definition) => this.view(definition));
    }
    return this.snapshot;
  }

  getActivePack(): InstalledPack | null {
    const id = this.state.activePackId;
    return id ? (this.state.installed[id] ?? null) : null;
  }

  getInstalledPacks(): InstalledPack[] {
    return this.catalog.flatMap((p) => (this.state.installed[p.id] ? [this.state.installed[p.id]] : []));
  }

  /** Choose which installed pack replaces the map's vector source. `null` returns to the online style. */
  setActivePack(id: string | null): void {
    if (id !== null && !this.state.installed[id]) {
      throw new PackError('unknown-pack', `Pack "${id}" is not installed.`);
    }
    this.state = { ...this.state, activePackId: id };
    this.commit();
  }

  /** Forget records whose file disappeared (user cleared storage, OS cleanup, failed restore). */
  reconcile(): void {
    const installed = { ...this.state.installed };
    let changed = false;
    for (const [id, pack] of Object.entries(installed)) {
      if (!this.catalog.some((p) => p.id === id) || !this.fs.exists(pack.fileUri)) {
        delete installed[id];
        changed = true;
      }
    }
    if (changed) {
      const activePackId =
        this.state.activePackId && installed[this.state.activePackId] ? this.state.activePackId : null;
      this.state = { installed, activePackId };
      this.commit();
    }
  }

  async download(id: string): Promise<InstalledPack> {
    const definition = this.requireDefinition(id);
    if (this.downloads.has(id)) {
      throw new PackError('already-downloading', `${definition.name} is already downloading.`);
    }
    if (isPlaceholderUrl(definition.url)) {
      throw new PackError('not-configured', `${definition.name} download URL is not configured yet.`);
    }
    const needed = Math.ceil(definition.approxBytes * DISK_SPACE_MARGIN);
    if (this.fs.availableDiskSpace() < needed) {
      throw new PackError('insufficient-storage', `Not enough free storage for ${definition.name}.`);
    }

    this.fs.ensurePacksDirectory();
    const finalUri = `${this.fs.packsDirectoryUri}${definition.id}.pmtiles`;
    const partUri = `${finalUri}.part`;
    const controller = new AbortController();
    const entry: ActiveDownload = {
      controller,
      progress: { bytesWritten: 0, totalBytes: definition.approxBytes },
    };
    this.downloads.set(id, entry);
    this.errors.delete(id);
    this.emit();

    try {
      this.fs.remove(partUri);
      await this.fs.download(definition.url, partUri, {
        signal: controller.signal,
        onProgress: (progress) => {
          entry.progress = {
            bytesWritten: progress.bytesWritten,
            totalBytes: progress.totalBytes > 0 ? progress.totalBytes : definition.approxBytes,
          };
          this.emit();
        },
      });
      if (controller.signal.aborted) throw new PackError('cancelled', 'Download cancelled.');

      const bytes = this.fs.sizeOf(partUri);
      const head = bytes >= MIN_PACK_BYTES ? await this.fs.readHead(partUri, PMTILES_MAGIC.length) : new Uint8Array();
      if (!isPmtilesHeader(head)) {
        throw new PackError('invalid-archive', `${definition.name} download is not a valid .pmtiles archive.`);
      }

      await this.fs.move(partUri, finalUri);
      const record: InstalledPack = {
        id,
        fileUri: finalUri,
        bytes,
        sourceUrl: definition.url,
        downloadedAt: this.now(),
      };
      this.state = {
        installed: { ...this.state.installed, [id]: record },
        activePackId: this.state.activePackId,
      };
      this.downloads.delete(id);
      this.commit();
      return record;
    } catch (e) {
      const error = this.toPackError(e, controller.signal.aborted);
      this.safeRemove(partUri);
      this.downloads.delete(id);
      if (error.code !== 'cancelled') this.errors.set(id, error.message);
      this.emit();
      throw error;
    }
  }

  cancelDownload(id: string): void {
    this.downloads.get(id)?.controller.abort();
  }

  remove(id: string): void {
    this.requireDefinition(id);
    this.cancelDownload(id);
    const record = this.state.installed[id];
    if (record) this.safeRemove(record.fileUri);
    const installed = { ...this.state.installed };
    delete installed[id];
    this.state = {
      installed,
      activePackId: this.state.activePackId === id ? null : this.state.activePackId,
    };
    this.errors.delete(id);
    this.commit();
  }

  private view(definition: PackDefinition): PackView {
    const download = this.downloads.get(definition.id);
    const installed = this.state.installed[definition.id];
    let status: PackStatus = { kind: 'not-installed' };
    if (download) {
      status = { kind: 'downloading', ...download.progress };
    } else if (installed) {
      status = { kind: 'installed', bytes: installed.bytes, downloadedAt: installed.downloadedAt };
    }
    return {
      definition,
      status,
      configured: !isPlaceholderUrl(definition.url),
      active: this.state.activePackId === definition.id,
      lastError: this.errors.get(definition.id) ?? null,
    };
  }

  private requireDefinition(id: string): PackDefinition {
    const definition = this.catalog.find((p) => p.id === id);
    if (!definition) throw new PackError('unknown-pack', `Unknown pack "${id}".`);
    return definition;
  }

  private toPackError(e: unknown, aborted: boolean): PackError {
    if (e instanceof PackError) return e;
    if (aborted) return new PackError('cancelled', 'Download cancelled.');
    const detail = e instanceof Error ? e.message : String(e);
    return new PackError('download-failed', `Download failed. Check your connection and try again. (${detail})`);
  }

  private safeRemove(uri: string): void {
    try {
      this.fs.remove(uri);
    } catch {
      // Best effort: a leftover .part file is overwritten on the next attempt.
    }
  }

  private readState(): PersistedState {
    const raw = this.storage.getString(PACK_STATE_KEY);
    if (!raw) return { ...EMPTY_STATE, installed: {} };
    try {
      const parsed = persistedStateSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
    } catch {
      // fall through to reset
    }
    this.storage.remove(PACK_STATE_KEY);
    return { ...EMPTY_STATE, installed: {} };
  }

  private commit(): void {
    this.storage.set(PACK_STATE_KEY, JSON.stringify(this.state));
    this.emit();
  }

  private emit(): void {
    this.snapshot = null;
    this.listeners.forEach((listener) => listener());
  }
}
