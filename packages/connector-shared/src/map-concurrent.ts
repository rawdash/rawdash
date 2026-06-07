export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  if (items.length === 0) {
    return results;
  }
  const normalized = Number.isFinite(concurrency) ? Math.floor(concurrency) : 1;
  const limit = Math.max(1, Math.min(normalized, items.length));
  let next = 0;
  let failed = false;

  async function worker(): Promise<void> {
    while (!failed) {
      const i = next++;
      if (i >= items.length) {
        return;
      }
      try {
        results[i] = await fn(items[i]!, i);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  }

  const workers: Promise<void>[] = [];
  for (let w = 0; w < limit; w++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}
