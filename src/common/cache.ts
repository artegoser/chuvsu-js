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

export class HybridCache {
  private memory: Cache;
  private ttls: Record<string, number | undefined>;
  private adapter?: CacheAdapter;

  constructor(
    ttls: Record<string, number | undefined>,
    adapter?: CacheAdapter,
  ) {
    this.ttls = ttls;
    this.memory = new Cache(ttls);
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
    return external;
  }

  async set(category: string, key: string, data: unknown): Promise<void> {
    this.memory.set(category, key, data);
    await this.setExternal(category, key, data);
  }

  async setExternal(category: string, key: string, data: unknown): Promise<void> {
    const ttl = this.ttls[category];
    if (ttl == null || !this.adapter) return;
    await this.adapter.set(category, key, data, ttl);
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
