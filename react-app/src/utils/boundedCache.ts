/**
 * Insertion-ordered cache with a hard entry cap.
 *
 * A plain `Map` iterates in insertion order, so the first key it yields is the oldest. That
 * is enough to evict least-recently-written entries in constant time, which matters for the
 * session caches that otherwise grow for as long as the app stays open: episode lists keyed
 * by podcast, and schedules keyed by station and date.
 */
export class BoundedCache<K, V> {
  private readonly entries = new Map<K, V>();
  private readonly maxEntries: number;

  // Declared rather than a parameter property: the test runner strips types without
  // transforming syntax, so only erasable TypeScript is allowed here.
  constructor(maxEntries: number) {
    this.maxEntries = maxEntries;
  }

  get size(): number {
    return this.entries.size;
  }

  has(key: K): boolean {
    return this.entries.has(key);
  }

  get(key: K): V | undefined {
    return this.entries.get(key);
  }

  /** Stores a value, evicting the oldest entries until the cache is back within its cap. */
  set(key: K, value: V): void {
    // Re-insert so that overwriting an existing key refreshes its recency.
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  delete(key: K): boolean {
    return this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  keys(): IterableIterator<K> {
    return this.entries.keys();
  }
}