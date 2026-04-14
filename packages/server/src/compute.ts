import type { ResolvedMetricDef } from '@rawdash/core';

type FilterClause = NonNullable<ResolvedMetricDef['filter']>[number];
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
  filter: ResolvedMetricDef['filter'],
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
  metric: ResolvedMetricDef,
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
      d.setMinutes(0, 0, 0);
      return d.toISOString();
    case 'day':
      d.setHours(0, 0, 0, 0);
      return d.toISOString().slice(0, 10);
    case 'week': {
      d.setDate(d.getDate() - d.getDay());
      d.setHours(0, 0, 0, 0);
      return d.toISOString().slice(0, 10);
    }
    case 'month':
      d.setDate(1);
      d.setHours(0, 0, 0, 0);
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

function computeGroupBy(
  records: Record<string, unknown>[],
  metric: ResolvedMetricDef,
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
      value: computeAgg(groupRecords, metric.field, metric.fn),
    }))
    .sort((a, b) => (String(a[field]) < String(b[field]) ? -1 : 1));
}

export function computeMetric(
  records: Record<string, unknown>[],
  metric: ResolvedMetricDef,
  fields: Record<string, { type: string }>,
): unknown {
  const windowed = applyWindow(records, metric, fields);
  const filtered = windowed.filter((r) => applyFilter(r, metric.filter));

  if (metric.groupBy) {
    return computeGroupBy(filtered, metric);
  }

  return computeAgg(filtered, metric.field, metric.fn);
}
