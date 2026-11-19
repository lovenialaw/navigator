import { Directory, File, FileMode, Paths } from 'expo-file-system';

import type { PackFileSystem } from './packFileSystem';

/** Packs live in the document directory so the OS never evicts them the way it can evict cache. */
export function createExpoPackFileSystem(): PackFileSystem {
  const directory = new Directory(Paths.document, 'offline-packs');
  const base = directory.uri.endsWith('/') ? directory.uri : `${directory.uri}/`;

  return {
    packsDirectoryUri: base,
    ensurePacksDirectory() {
      if (!directory.exists) {
        directory.create({ intermediates: true, idempotent: true });
      }
    },
    exists: (uri) => new File(uri).exists,
    sizeOf: (uri) => new File(uri).size,
    remove(uri) {
      const file = new File(uri);
      if (file.exists) file.delete();
    },
    async move(fromUri, toUri) {
      const target = new File(toUri);
      if (target.exists) target.delete();
      await new File(fromUri).move(target);
    },
    async readHead(uri, length) {
      const handle = new File(uri).open(FileMode.ReadOnly);
      try {
        return await handle.readBytes(length);
      } finally {
        handle.close();
      }
    },
    availableDiskSpace: () => Paths.availableDiskSpace,
    async download(url, destinationUri, { onProgress, signal }) {
      await File.downloadFileAsync(url, new File(destinationUri), {
        idempotent: true,
        onProgress,
        signal,
      });
    },
  };
}
