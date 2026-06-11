export type Granularity = 'hour' | 'day' | 'week' | 'month';

const WINDOW_UNIT_MS: Record<string, number> = {
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
  m: 2_592_000_000,
};

export function parseWindowMs(window: string): number | null {
  const match = /^(\d+)(h|d|w|m)$/.exec(window);
  if (!match) {
    return null;
  }
  const unitMs = WINDOW_UNIT_MS[match[2]!];
  if (unitMs === undefined) {
    return null;
  }
  return parseInt(match[1]!) * unitMs;
}

export function truncateToGranularity(ts: number, granularity: string): string {
  const d = new Date(ts);
  switch (granularity) {
    case 'hour':
      d.setUTCMinutes(0, 0, 0);
      return d.toISOString();
    case 'day':
      d.setUTCHours(0, 0, 0, 0);
      return d.toISOString().slice(0, 10);
    case 'week': {
      d.setUTCDate(d.getUTCDate() - d.getUTCDay());
      d.setUTCHours(0, 0, 0, 0);
      return d.toISOString().slice(0, 10);
    }
    case 'month':
      d.setUTCDate(1);
      d.setUTCHours(0, 0, 0, 0);
      return d.toISOString().slice(0, 7);
    default:
      return d.toISOString().slice(0, 10);
  }
}

export function bucketStartMs(ts: number, granularity: Granularity): number {
  const d = new Date(ts);
  switch (granularity) {
    case 'hour':
      d.setUTCMinutes(0, 0, 0);
      return d.getTime();
    case 'day':
      d.setUTCHours(0, 0, 0, 0);
      return d.getTime();
    case 'week':
      d.setUTCDate(d.getUTCDate() - d.getUTCDay());
      d.setUTCHours(0, 0, 0, 0);
      return d.getTime();
    case 'month':
      d.setUTCDate(1);
      d.setUTCHours(0, 0, 0, 0);
      return d.getTime();
  }
}

export function nextBucketStartMs(
  bucketStart: number,
  granularity: Granularity,
): number {
  const d = new Date(bucketStart);
  switch (granularity) {
    case 'hour':
      d.setUTCHours(d.getUTCHours() + 1);
      return d.getTime();
    case 'day':
      d.setUTCDate(d.getUTCDate() + 1);
      return d.getTime();
    case 'week':
      d.setUTCDate(d.getUTCDate() + 7);
      return d.getTime();
    case 'month':
      d.setUTCMonth(d.getUTCMonth() + 1);
      return d.getTime();
  }
}

const GRANULARITY_RANK: Record<Granularity, number> = {
  hour: 0,
  day: 1,
  week: 2,
  month: 3,
};

export function finerGranularity(a: Granularity, b: Granularity): Granularity {
  return GRANULARITY_RANK[a] <= GRANULARITY_RANK[b] ? a : b;
}

export function isGranularityCoarserOrEqual(
  query: Granularity,
  bucket: Granularity,
): boolean {
  return GRANULARITY_RANK[query] >= GRANULARITY_RANK[bucket];
}
