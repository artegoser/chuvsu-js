export interface CacheEntry {
  data: unknown;
  timestamp: number;
}

export interface CacheAdapter {
  get(category: string, key: string): Promise<unknown | null | undefined>;
  set(
    category: string,
    key: string,
    data: unknown,
    ttl?: number,
  ): Promise<void>;
  clear?(category?: string): Promise<void>;
  delete?(category: string, key: string): Promise<void>;
}

export interface BlobPutOptions {
  contentType?: string;
  ttl?: number;
}

export interface BlobAdapter {
  get(key: string): Promise<Buffer | null>;
  put(key: string, data: Buffer, opts?: BlobPutOptions): Promise<void>;
  delete?(key: string): Promise<void>;
}

export class Cache {
  private ttls: Record<string, number | undefined>;
  private store = new Map<string, CacheEntry>();

  constructor(ttls: Record<string, number | undefined>) {
    for (const [category, ttl] of Object.entries(ttls)) {
      if (
        ttl != null &&
        ttl !== Infinity &&
        (!Number.isFinite(ttl) || ttl < 0)
      ) {
        throw new RangeError(`Invalid cache TTL for ${category}`);
      }
    }
    this.ttls = { ...ttls };
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

    return structuredClone(entry.data);
  }

  set(category: string, key: string, data: unknown): void {
    if (this.ttls[category] == null) return;
    this.store.set(`${category}:${key}`, {
      data: structuredClone(data),
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
    return structuredClone(Object.fromEntries(this.store));
  }

  import(data: Record<string, CacheEntry>): void {
    for (const [key, entry] of Object.entries(data)) {
      const separator = key.indexOf(":");
      const category =
        separator < 1 || separator === key.length - 1
          ? ""
          : key.slice(0, separator);
      if (this.ttls[category] == null) {
        throw new TypeError(`Invalid or disabled cache category in ${key}`);
      }
      if (
        entry == null ||
        typeof entry !== "object" ||
        !Number.isFinite(entry.timestamp) ||
        entry.timestamp < 0 ||
        !("data" in entry)
      ) {
        throw new TypeError(`Invalid cache entry: ${key}`);
      }
      this.store.set(key, structuredClone(entry));
    }
  }
}

export class HybridCache {
  private memory: Cache;
  private ttls: Record<string, number | undefined>;
  private adapter?: CacheAdapter;

  constructor(
    ttls: Record<string, number | undefined>,
    adapter?: CacheAdapter,
  ) {
    this.ttls = { ...ttls };
    this.memory = new Cache(this.ttls);
    this.adapter = adapter;
  }

  ttl(category: string): number | undefined {
    return this.ttls[category];
  }

  getLocal(category: string, key: string): unknown | null {
    return this.memory.get(category, key);
  }

  setLocal(category: string, key: string, data: unknown): void {
    this.memory.set(category, key, data);
  }

  async get(category: string, key: string): Promise<unknown | null> {
    const local = this.memory.get(category, key);
    if (local !== null) return local;

    const ttl = this.ttls[category];
    if (ttl == null || !this.adapter) return null;

    const external = await this.adapter.get(category, key);
    if (external === null || external === undefined) return null;

    this.memory.set(category, key, external);
    return this.memory.get(category, key);
  }

  async set(category: string, key: string, data: unknown): Promise<void> {
    this.memory.set(category, key, data);
    await this.setExternal(category, key, data);
  }

  async setExternal(category: string, key: string, data: unknown): Promise<void> {
    const ttl = this.ttls[category];
    if (ttl == null || !this.adapter) return;
    await this.adapter.set(category, key, structuredClone(data), ttl);
  }

  async clear(category?: string): Promise<void> {
    this.memory.clear(category);
    await this.adapter?.clear?.(category);
  }

  export(): Record<string, CacheEntry> {
    return this.memory.export();
  }

  import(data: Record<string, CacheEntry>): void {
    this.memory.import(data);
  }
}
