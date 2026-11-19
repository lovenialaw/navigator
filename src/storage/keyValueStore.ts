export interface KeyValueStore {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export class MemoryKeyValueStore implements KeyValueStore {
  private readonly data = new Map<string, string>();

  getString(key: string): string | undefined {
    return this.data.get(key);
  }

  set(key: string, value: string): void {
    this.data.set(key, value);
  }

  remove(key: string): void {
    this.data.delete(key);
  }
}
