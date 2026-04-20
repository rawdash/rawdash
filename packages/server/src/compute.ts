import type { ResolvedMetric, StorageHandle } from '@rawdash/core';

type FilterClause = NonNullable<ResolvedMetric['filter']>[number];
type FilterCondition = Exclude<FilterClause, { or: unknown[] }>;

function matchesCondition(
  record: Record<string, unknown>,
  cond: FilterCondition,
): boolean {
  const val = record[cond.field];
  switch (cond.op) {
    case 'eq':
      return val === cond.value;
    case 'neq':
      return val !== cond.value;
    case 'gt':
      return (val as number) > (cond.value as number);
    case 'gte':
      return (val as number) >= (cond.value as number);
    case 'lt':
      return (val as number) < (cond.value as number);
    case 'lte':
      return (val as number) <= (cond.value as number);
    case 'contains':
      return String(val).includes(String(cond.value));
    default:
      return false;
  }
}

function applyFilter(
  record: Record<string, unknown>,
  filter: ResolvedMetric['filter'],
): boolean {
  if (!filter) {
    return true;
  }
  for (const clause of filter) {
    if ('or' in clause) {
      if (!clause.or.some((cond) => matchesCondition(record, cond))) {
        return false;
      }
    } else {
      if (!matchesCondition(record, clause)) {
        return false;
      }
    }
  }
  return true;
}

const WINDOW_MS: Record<string, number> = {
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
  m: 2_592_000_000,
};

function parseWindowMs(window: string): number | null {
  const match = /^(\d+)(h|d|w|m)$/.exec(window);
  if (!match) {
    return null;
  }
  const unitMs = WINDOW_MS[match[2]!];
  if (unitMs === undefined) {
    return null;
  }
  return parseInt(match[1]!) * unitMs;
}

function truncateToGranularity(ts: number, granularity: string): string {
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

function computeAgg(
  records: Record<string, unknown>[],
  field: string,
  fn: string,
): unknown {
  if (fn === 'count') {
    return records.length;
  }
  if (fn === 'latest') {
    return records.at(-1)?.[field] ?? null;
  }
  if (fn === 'first') {
    return records[0]?.[field] ?? null;
  }
  const values = records
    .map((r) => r[field])
    .filter((v) => v !== undefined && v !== null);
  const nonNumeric = values.find((v) => typeof v !== 'number');
  if (nonNumeric !== undefined) {
    throw new Error(
      `computeAgg: fn "${fn}" requires numeric values for field "${field}", got ${typeof nonNumeric} (${String(nonNumeric)})`,
    );
  }
  const numbers = values as number[];
  if (fn === 'sum') {
    return numbers.reduce((a, b) => a + b, 0);
  }
  if (fn === 'avg') {
    return numbers.length > 0
      ? numbers.reduce((a, b) => a + b, 0) / numbers.length
      : null;
  }
  if (fn === 'min') {
    return numbers.length > 0 ? Math.min(...numbers) : null;
  }
  if (fn === 'max') {
    return numbers.length > 0 ? Math.max(...numbers) : null;
  }
  return null;
}

function sortByTs(
  records: Record<string, unknown>[],
  tsField: string,
): Record<string, unknown>[] {
  return [...records].sort((a, b) => {
    return (a[tsField] as number) - (b[tsField] as number);
  });
}

function computeGroupBy(
  records: Record<string, unknown>[],
  metric: ResolvedMetric,
  tsField: string,
): unknown {
  const { field, granularity } = metric.groupBy!;
  const groups = new Map<string, Record<string, unknown>[]>();

  for (const record of records) {
    const ts = record[field] as number | undefined;
    if (ts === undefined || typeof ts !== 'number') {
      continue;
    }
    const key = truncateToGranularity(ts, granularity);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(record);
  }

  return [...groups.entries()]
    .map(([key, groupRecords]) => ({
      date: key,
      value: computeAgg(
        sortByTs(groupRecords, tsField),
        metric.field,
        metric.fn,
      ),
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

function getTimestampField(shape: string): string {
  switch (shape) {
    case 'event':
      return 'start_ts';
    case 'metric':
    case 'distribution':
      return 'ts';
    case 'entity':
    case 'edge':
      return 'updated_at';
    default:
      return 'start_ts';
  }
}

export async function computeMetric(
  storage: StorageHandle,
  metric: ResolvedMetric,
): Promise<unknown> {
  const tsField = getTimestampField(metric.shape);

  const windowMs = metric.window ? parseWindowMs(metric.window) : null;
  const windowStart = windowMs !== null ? Date.now() - windowMs : undefined;

  let records: Record<string, unknown>[];

  switch (metric.shape) {
    case 'event': {
      const events = await storage.queryEvents({
        name: metric.name,
        start: windowStart,
      });
      records = events.map((e) => ({
        ...e.attributes,
        name: e.name,
        start_ts: e.start_ts,
        end_ts: e.end_ts,
      }));
      break;
    }

    case 'entity': {
      const type = metric.entityType ?? metric.name ?? '';
      const entities = await storage.queryEntities({ type });
      records = entities.map((e) => ({
        ...e.attributes,
        type: e.type,
        id: e.id,
        updated_at: e.updated_at,
      }));
      if (windowStart !== undefined) {
        records = records.filter((r) => (r[tsField] as number) >= windowStart);
      }
      break;
    }

    case 'metric': {
      const metrics = await storage.queryMetrics({
        name: metric.name,
        start: windowStart,
      });
      records = metrics.map((m) => ({
        ...m.attributes,
        name: m.name,
        ts: m.ts,
        value: m.value,
      }));
      break;
    }

    case 'edge': {
      const edges = await storage.traverse({ kind: metric.name });
      records = edges.map((e) => ({
        ...e.attributes,
        from_type: e.from_type,
        from_id: e.from_id,
        kind: e.kind,
        to_type: e.to_type,
        to_id: e.to_id,
        updated_at: e.updated_at,
      }));
      if (windowStart !== undefined) {
        records = records.filter((r) => (r[tsField] as number) >= windowStart);
      }
      break;
    }

    case 'distribution': {
      const distributions = await storage.queryDistributions({
        name: metric.name,
        start: windowStart,
      });
      records = distributions.map((d) => ({
        ...d.attributes,
        name: d.name,
        ts: d.ts,
        kind: d.kind,
        data: d.data,
      }));
      break;
    }

    default:
      return null;
  }

  const filtered = records.filter((r) => applyFilter(r, metric.filter));
  const sorted = sortByTs(filtered, tsField);

  if (metric.groupBy) {
    return computeGroupBy(sorted, metric, tsField);
  }

  return computeAgg(sorted, metric.field, metric.fn);
}
