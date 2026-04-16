import type { ResolvedMetric } from '@rawdash/core';

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

function applyWindow(
  records: Record<string, unknown>[],
  metric: ResolvedMetric,
  fields: Record<string, { type: string }>,
): Record<string, unknown>[] {
  if (!metric.window) {
    return records;
  }
  const match = /^(\d+)(h|d|w|m)$/.exec(metric.window);
  if (!match) {
    return records;
  }
  const ms = parseInt(match[1]!) * (WINDOW_MS[match[2]!] ?? 0);
  const cutoff = Date.now() - ms;

  const timestampField =
    (fields[metric.field]?.type === 'timestamp' ? metric.field : undefined) ??
    metric.groupBy?.field ??
    Object.entries(fields).find(([, f]) => f.type === 'timestamp')?.[0];
  if (!timestampField) {
    return records;
  }

  return records.filter(
    (r) => new Date(r[timestampField] as string).getTime() >= cutoff,
  );
}

function truncateToGranularity(date: Date, granularity: string): string {
  const d = new Date(date);
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
  const numbers = records
    .map((r) => r[field])
    .filter((v): v is number => typeof v === 'number');
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

function sortByTimestamp(
  records: Record<string, unknown>[],
  timestampField: string,
): Record<string, unknown>[] {
  return [...records].sort((a, b) => {
    const ta = new Date(a[timestampField] as string).getTime();
    const tb = new Date(b[timestampField] as string).getTime();
    return ta - tb;
  });
}

function computeGroupBy(
  records: Record<string, unknown>[],
  metric: ResolvedMetric,
): unknown {
  const { field, granularity } = metric.groupBy!;
  const groups = new Map<string, Record<string, unknown>[]>();

  for (const record of records) {
    const d = new Date(record[field] as string);
    if (isNaN(d.getTime())) {
      continue;
    }
    const key = truncateToGranularity(d, granularity);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(record);
  }

  return [...groups.entries()]
    .map(([key, groupRecords]) => ({
      [field]: key,
      value: computeAgg(
        sortByTimestamp(groupRecords, field),
        metric.field,
        metric.fn,
      ),
    }))
    .sort((a, b) => (String(a[field]) < String(b[field]) ? -1 : 1));
}

export function computeMetric(
  records: Record<string, unknown>[],
  metric: ResolvedMetric,
  fields: Record<string, { type: string }>,
): unknown {
  const windowed = applyWindow(records, metric, fields);
  const filtered = windowed.filter((r) => applyFilter(r, metric.filter));

  const timestampField =
    (fields[metric.field]?.type === 'timestamp' ? metric.field : undefined) ??
    metric.groupBy?.field ??
    Object.entries(fields).find(([, f]) => f.type === 'timestamp')?.[0];
  const sorted = timestampField
    ? sortByTimestamp(filtered, timestampField)
    : filtered;

  if (metric.groupBy) {
    return computeGroupBy(sorted, metric);
  }

  return computeAgg(sorted, metric.field, metric.fn);
}
