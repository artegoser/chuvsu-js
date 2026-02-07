export interface CacheEntry {
  data: unknown;
  timestamp: number;
}

export class Cache {
  private ttls: Record<string, number | undefined>;
  private store = new Map<string, CacheEntry>();

  constructor(ttls: Record<string, number | undefined>) {
    this.ttls = ttls;
  }

  get(category: string, key: string): unknown | null {
    const ttl = this.ttls[category];
    if (ttl == null) return null;

    const entry = this.store.get(`${category}:${key}`);
    if (!entry) return null;

    if (ttl !== Infinity && Date.now() - entry.timestamp > ttl) {
      this.store.delete(`${category}:${key}`);
      return null;
    }

    return entry.data;
  }

  set(category: string, key: string, data: unknown): void {
    if (this.ttls[category] == null) return;
    this.store.set(`${category}:${key}`, {
      data,
      timestamp: Date.now(),
    });
  }

  clear(category?: string): void {
    if (!category) {
      this.store.clear();
      return;
    }
    const prefix = `${category}:`;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }

  export(): Record<string, CacheEntry> {
    return Object.fromEntries(this.store);
  }

  import(data: Record<string, CacheEntry>): void {
    for (const [key, entry] of Object.entries(data)) {
      this.store.set(key, entry);
    }
  }
}
