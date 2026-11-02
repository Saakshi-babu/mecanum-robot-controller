/** Fixed-capacity append-only buffer; oldest entries are dropped. */
export class RingBuffer<T> {
  private items: T[] = [];

  constructor(private readonly capacity: number) {}

  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.capacity) this.items.splice(0, this.items.length - this.capacity);
  }

  toArray(): readonly T[] {
    return this.items;
  }

  last(): T | undefined {
    return this.items[this.items.length - 1];
  }

  get length(): number {
    return this.items.length;
  }

  clear(): void {
    this.items = [];
  }

  /** Items with timestamp in [from, to]. Assumes items are appended in time order. */
  between(from: number, to: number, ts: (t: T) => number): T[] {
    return this.items.filter((it) => {
      const t = ts(it);
      return t >= from && t <= to;
    });
  }
}
