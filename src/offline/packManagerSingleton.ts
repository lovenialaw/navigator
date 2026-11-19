import { loadConfig } from '../config/tujuConfig';
import { getMmkvStore } from '../storage/mmkvStore';
import { createExpoPackFileSystem } from './expoPackFileSystem';
import { PackManager } from './packManager';

let instance: PackManager | null = null;

export const configResult = loadConfig();

export function getPackManager(): PackManager {
  if (!instance) {
    instance = new PackManager({
      catalog: configResult.config.packs,
      storage: getMmkvStore(),
      fileSystem: createExpoPackFileSystem(),
    });
  }
  return instance;
}
