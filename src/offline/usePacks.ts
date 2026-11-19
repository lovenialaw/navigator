import { useSyncExternalStore } from 'react';

import type { PackManager, PackView } from './packManager';

export function usePacks(manager: PackManager): PackView[] {
  return useSyncExternalStore(
    (listener) => manager.subscribe(listener),
    () => manager.list(),
    () => manager.list(),
  );
}
