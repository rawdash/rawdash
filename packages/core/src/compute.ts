import type { ComputedMetric } from './config';
import type { StorageHandle } from './connector';
import { applyFilter } from './filter-match';
import { tryComputeMetricFromRollups } from './rollup';
import { parseWindowMs, truncateToGranularity } from './time-buckets';

function computeAgg(
  records: Record<string, unknown>[],
  field: string | undefined,
  fn: string,
): unknown {
  if (fn === 'count') {
    return records.length;
  }
  if (field === undefined) {
    throw new Error(`computeAgg: fn "${fn}" requires a field`);
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
    return numbers.length > 0
      ? numbers.reduce((a, b) => (a < b ? a : b))
      : null;
  }
  if (fn === 'max') {
    return numbers.length > 0
      ? numbers.reduce((a, b) => (a > b ? a : b))
      : null;
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
  metric: ComputedMetric,
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
  metric: ComputedMetric,
): Promise<unknown> {
  const rollupResult = await tryComputeMetricFromRollups(storage, metric);
  if (rollupResult.used) {
    return rollupResult.value;
  }

  const tsField = getTimestampField(metric.shape);

  const windowMs = metric.window ? parseWindowMs(metric.window) : null;
  const windowStart = windowMs !== null ? Date.now() - windowMs : undefined;

  let records: Record<string, unknown>[];

  switch (metric.shape) {
    case 'event': {
      const events = await storage.queryEvents({
        name: metric.name ?? metric.entityType,
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
        name: metric.name ?? metric.entityType,
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
        name: metric.name ?? metric.entityType,
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
