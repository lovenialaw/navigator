export interface DownloadProgress {
  bytesWritten: number;
  totalBytes: number;
}

/** Narrow file-system surface the pack manager needs. Lets tests run without native modules. */
export interface PackFileSystem {
  /** Directory URI (with trailing slash) that holds installed packs. */
  readonly packsDirectoryUri: string;
  ensurePacksDirectory(): void;
  exists(uri: string): boolean;
  sizeOf(uri: string): number;
  remove(uri: string): void;
  move(fromUri: string, toUri: string): Promise<void>;
  readHead(uri: string, length: number): Promise<Uint8Array>;
  availableDiskSpace(): number;
  download(
    url: string,
    destinationUri: string,
    options: { onProgress?: (progress: DownloadProgress) => void; signal?: AbortSignal },
  ): Promise<void>;
}
