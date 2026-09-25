/**
 * A counting limiter: at most `max` tasks run at once; the rest wait in order.
 *
 * Used where a burst would hurt the process rather than a remote quota — the
 * Article Finder checking a dozen sources in parallel, and PDF parsing, which is
 * CPU-bound on the main thread and peaks at several times the file's size in
 * memory. One serverless instance serves several requests at once, so an
 * unbounded burst from one search degrades everyone else's.
 */
export function createLimiter(max: number) {
  const limit = Math.max(1, Math.floor(max));
  let active = 0;
  const waiting: Array<() => void> = [];

  // A finished task hands its slot STRAIGHT to the next waiter. Freeing it and
  // letting the waiter re-claim it left a gap in which a newcomer could take
  // the slot too, briefly running limit + 1 tasks.
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else active--;
  };

  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    else active++;
    try {
      return await task();
    } finally {
      release();
    }
  };
}

/** Map over `items` with at most `max` calls of `fn` in flight, preserving order. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  max: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const run = createLimiter(max);
  return Promise.all(items.map((item, i) => run(() => fn(item, i))));
}
