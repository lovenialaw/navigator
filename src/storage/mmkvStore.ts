import { createMMKV } from 'react-native-mmkv';

import type { KeyValueStore } from './keyValueStore';

let shared: KeyValueStore | null = null;

/** Synchronous, on-device, and needs no login or network: safe on a cold launch. */
export function getMmkvStore(): KeyValueStore {
  if (!shared) {
    const mmkv = createMMKV({ id: 'tuju.app' });
    shared = {
      getString: (key) => mmkv.getString(key),
      set: (key, value) => mmkv.set(key, value),
      remove: (key) => {
        mmkv.remove(key);
      },
    };
  }
  return shared;
}
