import type {
  AggFn,
  ComputedMetric,
  DashboardConfig,
  Shape,
  Widget,
} from './config';
import type {
  JSONValue,
  RollupBucket,
  RollupPartials,
  StorageHandle,
} from './connector';
import { applyFilter } from './filter-match';
import type { FilterClause, FilterCondition } from './filters';
import {
  type Granularity,
  bucketStartMs,
  finerGranularity,
  isGranularityCoarserOrEqual,
  truncateToGranularity,
} from './time-buckets';

const ROLLUP_SHAPES: ReadonlySet<Shape> = new Set(['event', 'metric']);

export function isRollupShape(shape: Shape): boolean {
  return ROLLUP_SHAPES.has(shape);
}

function rollupTsField(shape: Shape): string {
  return shape === 'event' ? 'start_ts' : 'ts';
}

export function emptyPartials(): RollupPartials {
  return {
    count: 0,
    numericCount: 0,
    sum: 0,
    min: null,
    max: null,
    firstTs: null,
    firstValue: null,
    latestTs: null,
    latestValue: null,
  };
}

export function foldValueIntoPartials(
  partials: RollupPartials,
  ts: number,
  value: JSONValue | undefined,
): void {
  partials.count += 1;
  if (typeof value === 'number' && Number.isFinite(value)) {
    partials.numericCount += 1;
    partials.sum += value;
    partials.min =
      partials.min === null ? value : Math.min(partials.min, value);
    partials.max =
      partials.max === null ? value : Math.max(partials.max, value);
  }
  const v = value ?? null;
  if (partials.firstTs === null || ts < partials.firstTs) {
    partials.firstTs = ts;
    partials.firstValue = v;
  }
  if (partials.latestTs === null || ts >= partials.latestTs) {
    partials.latestTs = ts;
    partials.latestValue = v;
  }
}

export function mergePartials(
  a: RollupPartials,
  b: RollupPartials,
): RollupPartials {
  const out: RollupPartials = {
    count: a.count + b.count,
    numericCount: a.numericCount + b.numericCount,
    sum: a.sum + b.sum,
    min: minNullable(a.min, b.min),
    max: maxNullable(a.max, b.max),
    firstTs: null,
    firstValue: null,
    latestTs: null,
    latestValue: null,
  };
  const first = earlier(a.firstTs, a.firstValue, b.firstTs, b.firstValue);
  out.firstTs = first.ts;
  out.firstValue = first.value;
  const latest = later(a.latestTs, a.latestValue, b.latestTs, b.latestValue);
  out.latestTs = latest.ts;
  out.latestValue = latest.value;
  return out;
}

function minNullable(a: number | null, b: number | null): number | null {
  if (a === null) {
    return b;
  }
  if (b === null) {
    return a;
  }
  return Math.min(a, b);
}

function maxNullable(a: number | null, b: number | null): number | null {
  if (a === null) {
    return b;
  }
  if (b === null) {
    return a;
  }
  return Math.max(a, b);
}

function earlier(
  aTs: number | null,
  aValue: JSONValue,
  bTs: number | null,
  bValue: JSONValue,
): { ts: number | null; value: JSONValue } {
  if (aTs === null) {
    return { ts: bTs, value: bValue };
  }
  if (bTs === null) {
    return { ts: aTs, value: aValue };
  }
  return aTs <= bTs ? { ts: aTs, value: aValue } : { ts: bTs, value: bValue };
}

function later(
  aTs: number | null,
  aValue: JSONValue,
  bTs: number | null,
  bValue: JSONValue,
): { ts: number | null; value: JSONValue } {
  if (aTs === null) {
    return { ts: bTs, value: bValue };
  }
  if (bTs === null) {
    return { ts: aTs, value: aValue };
  }
  return aTs >= bTs ? { ts: aTs, value: aValue } : { ts: bTs, value: bValue };
}

export function aggFromPartials(fn: AggFn, partials: RollupPartials): unknown {
  switch (fn) {
    case 'count':
      return partials.count;
    case 'sum':
      return partials.sum;
    case 'avg':
      return partials.numericCount > 0
        ? partials.sum / partials.numericCount
        : null;
    case 'min':
      return partials.min;
    case 'max':
      return partials.max;
    case 'latest':
      return partials.latestValue;
    case 'first':
      return partials.firstValue;
  }
}

function fieldKey(field: string | undefined): string {
  return field ?? '';
}

export function dimsKey(dims: Record<string, JSONValue>): string {
  const keys = Object.keys(dims).sort();
  return keys.map((k) => `${k}=${JSON.stringify(dims[k] ?? null)}`).join('&');
}

export interface RollupSignature {
  fn: AggFn;
  field?: string;
}

export interface RollupSpec {
  resource: string;
  shape: Shape;
  granularity: Granularity;
  dimFields: string[];
  signatures: RollupSignature[];
}

export type ConnectorRollupSpecs = Map<string, RollupSpec>;

function widgetGranularity(widget: Widget): Granularity {
  const metricGran =
    widget.kind === 'status' ? undefined : widget.metric.groupBy?.granularity;
  if (metricGran) {
    return metricGran;
  }
  if (widget.kind === 'timeseries' && widget.granularity) {
    return widget.granularity;
  }
  return 'day';
}

function collectDimFields(
  filter: FilterClause[] | undefined,
  out: Set<string>,
): void {
  if (!filter) {
    return;
  }
  for (const clause of filter) {
    if ('or' in clause) {
      for (const cond of clause.or) {
        addDimField(cond, out);
      }
    } else {
      addDimField(clause, out);
    }
  }
}

function addDimField(cond: FilterCondition, out: Set<string>): void {
  if (cond.op === 'eq' || cond.op === 'neq') {
    out.add(cond.field);
  }
}

interface SpecAccumulator {
  resource: string;
  shape: Shape;
  granularity: Granularity;
  dimFields: Set<string>;
  signatures: Map<string, RollupSignature>;
}

export function computeRollupSpecs(
  config: DashboardConfig,
): Map<string, ConnectorRollupSpecs> {
  const acc = new Map<string, Map<string, SpecAccumulator>>();

  for (const dashboard of Object.values(config.dashboards)) {
    for (const widget of Object.values(dashboard.widgets)) {
      if (widget.kind === 'status') {
        continue;
      }
      const metric = widget.metric;
      if (!isRollupShape(metric.shape)) {
        continue;
      }
      const resource = metric.name;
      if (resource === undefined) {
        continue;
      }

      let resources = acc.get(metric.connectorId);
      if (!resources) {
        resources = new Map<string, SpecAccumulator>();
        acc.set(metric.connectorId, resources);
      }

      let entry = resources.get(resource);
      if (!entry) {
        entry = {
          resource,
          shape: metric.shape,
          granularity: widgetGranularity(widget),
          dimFields: new Set<string>(),
          signatures: new Map<string, RollupSignature>(),
        };
        resources.set(resource, entry);
      } else {
        if (entry.shape !== metric.shape) {
          throw new Error(
            `computeRollupSpecs: resource "${resource}" on connector "${metric.connectorId}" is used by multiple shapes (${entry.shape}, ${metric.shape})`,
          );
        }
        entry.granularity = finerGranularity(
          entry.granularity,
          widgetGranularity(widget),
        );
      }

      collectDimFields(metric.filter, entry.dimFields);
      const signature: RollupSignature = { fn: metric.fn, field: metric.field };
      entry.signatures.set(signatureKey(signature), signature);
    }
  }

  const result = new Map<string, ConnectorRollupSpecs>();
  for (const [connectorId, resources] of acc) {
    const specs: ConnectorRollupSpecs = new Map<string, RollupSpec>();
    for (const [resource, entry] of resources) {
      specs.set(resource, {
        resource,
        shape: entry.shape,
        granularity: entry.granularity,
        dimFields: [...entry.dimFields].sort(),
        signatures: [...entry.signatures.values()],
      });
    }
    result.set(connectorId, specs);
  }
  return result;
}

function signatureKey(sig: RollupSignature): string {
  return `${sig.fn}:${fieldKey(sig.field)}`;
}

function pickDims(
  record: Record<string, unknown>,
  dimFields: string[],
): Record<string, JSONValue> {
  const dims: Record<string, JSONValue> = {};
  for (const field of dimFields) {
    dims[field] = (record[field] ?? null) as JSONValue;
  }
  return dims;
}

export interface FoldResult {
  resource: string;
  watermark: number;
  bucketsWritten: number;
}

export async function foldResourceRollups(
  handle: StorageHandle,
  spec: RollupSpec,
  now: number = Date.now(),
): Promise<FoldResult> {
  if (
    !handle.queryRollups ||
    !handle.writeRollups ||
    !handle.getRollupWatermark ||
    !handle.setRollupWatermark
  ) {
    throw new Error(
      'foldResourceRollups: storage handle does not support rollups',
    );
  }

  const watermark = await handle.getRollupWatermark(spec.resource);
  const tsField = rollupTsField(spec.shape);
  const currentBucketStart = bucketStartMs(now, spec.granularity);

  const records = await readRawRecords(handle, spec, watermark ?? undefined);

  const fields = new Map<string, string | undefined>();
  for (const sig of spec.signatures) {
    fields.set(fieldKey(sig.field), sig.field);
  }

  const buckets = new Map<string, RollupBucket>();

  for (const record of records) {
    const ts = record[tsField];
    if (typeof ts !== 'number' || ts >= currentBucketStart) {
      continue;
    }
    const bStart = bucketStartMs(ts, spec.granularity);
    const dims = pickDims(record, spec.dimFields);
    const dk = dimsKey(dims);

    for (const [fk, field] of fields) {
      const key = `${fk}|${dk}|${bStart}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          resource: spec.resource,
          field: fk,
          granularity: spec.granularity,
          dims,
          bucketStart: bStart,
          partials: emptyPartials(),
        };
        buckets.set(key, bucket);
      }
      const value =
        field !== undefined
          ? (record[field] as JSONValue | undefined)
          : undefined;
      foldValueIntoPartials(bucket.partials, ts, value);
    }
  }

  const list = [...buckets.values()];
  if (list.length > 0) {
    await handle.writeRollups(list);
  }
  if (watermark === null || currentBucketStart > watermark) {
    await handle.setRollupWatermark(spec.resource, currentBucketStart);
  }

  return {
    resource: spec.resource,
    watermark: currentBucketStart,
    bucketsWritten: list.length,
  };
}

export async function foldConnectorRollups(
  handle: StorageHandle,
  specs: ConnectorRollupSpecs,
  now: number = Date.now(),
): Promise<FoldResult[]> {
  const results: FoldResult[] = [];
  for (const spec of specs.values()) {
    results.push(await foldResourceRollups(handle, spec, now));
  }
  return results;
}

async function readRawRecords(
  handle: StorageHandle,
  spec: RollupSpec,
  start: number | undefined,
): Promise<Record<string, unknown>[]> {
  if (spec.shape === 'event') {
    const events = await handle.queryEvents({ name: spec.resource, start });
    return events.map((e) => ({
      ...e.attributes,
      name: e.name,
      start_ts: e.start_ts,
      end_ts: e.end_ts,
    }));
  }
  const metrics = await handle.queryMetrics({ name: spec.resource, start });
  return metrics.map((m) => ({
    ...m.attributes,
    name: m.name,
    ts: m.ts,
    value: m.value,
  }));
}

export type RollupReadResult = { used: false } | { used: true; value: unknown };

function filterServeableByDims(filter: FilterClause[] | undefined): boolean {
  if (!filter) {
    return true;
  }
  for (const clause of filter) {
    if ('or' in clause) {
      if (!clause.or.every(isDimCondition)) {
        return false;
      }
    } else if (!isDimCondition(clause)) {
      return false;
    }
  }
  return true;
}

function isDimCondition(cond: FilterCondition): boolean {
  return cond.op === 'eq' || cond.op === 'neq';
}

function requiredDimFields(filter: FilterClause[] | undefined): string[] {
  const fields = new Set<string>();
  for (const clause of filter ?? []) {
    if ('or' in clause) {
      for (const cond of clause.or) {
        fields.add(cond.field);
      }
    } else {
      fields.add(clause.field);
    }
  }
  return [...fields];
}

function foldRecordsIntoPartials(
  records: Record<string, unknown>[],
  field: string | undefined,
  tsField: string,
): RollupPartials {
  const partials = emptyPartials();
  for (const record of records) {
    const ts = record[tsField];
    if (typeof ts !== 'number') {
      continue;
    }
    const value =
      field !== undefined
        ? (record[field] as JSONValue | undefined)
        : undefined;
    foldValueIntoPartials(partials, ts, value);
  }
  return partials;
}

export async function tryComputeMetricFromRollups(
  handle: StorageHandle,
  metric: ComputedMetric,
): Promise<RollupReadResult> {
  if (
    !handle.queryRollups ||
    !handle.getRollupWatermark ||
    !isRollupShape(metric.shape) ||
    metric.window !== undefined ||
    metric.name === undefined ||
    !filterServeableByDims(metric.filter)
  ) {
    return { used: false };
  }

  const tsField = rollupTsField(metric.shape);

  if (metric.groupBy && metric.groupBy.field !== tsField) {
    return { used: false };
  }

  const watermark = await handle.getRollupWatermark(metric.name);
  if (watermark === null) {
    return { used: false };
  }

  const fk = fieldKey(metric.field);
  const buckets = await handle.queryRollups({
    resource: metric.name,
    field: fk,
  });

  if (
    metric.groupBy &&
    !buckets.every((b) =>
      isGranularityCoarserOrEqual(metric.groupBy!.granularity, b.granularity),
    )
  ) {
    return { used: false };
  }

  const required = requiredDimFields(metric.filter);
  if (required.some((field) => buckets.some((b) => !(field in b.dims)))) {
    return { used: false };
  }

  const matchingBuckets = buckets.filter((b) =>
    applyFilter(b.dims, metric.filter),
  );

  const rawTail = await readRawRecords(handle, rawSpec(metric), watermark);
  const filteredRaw = rawTail.filter((r) => applyFilter(r, metric.filter));

  if (metric.groupBy) {
    return {
      used: true,
      value: mergeGroupBy(
        matchingBuckets,
        filteredRaw,
        metric,
        tsField,
        metric.groupBy.granularity,
      ),
    };
  }

  let merged = emptyPartials();
  for (const bucket of matchingBuckets) {
    merged = mergePartials(merged, bucket.partials);
  }
  merged = mergePartials(
    merged,
    foldRecordsIntoPartials(filteredRaw, metric.field, tsField),
  );
  return { used: true, value: aggFromPartials(metric.fn, merged) };
}

function rawSpec(metric: ComputedMetric): RollupSpec {
  return {
    resource: metric.name!,
    shape: metric.shape,
    granularity: 'day',
    dimFields: [],
    signatures: [],
  };
}

function mergeGroupBy(
  buckets: RollupBucket[],
  rawRecords: Record<string, unknown>[],
  metric: ComputedMetric,
  tsField: string,
  granularity: Granularity,
): { date: string; value: unknown }[] {
  const groups = new Map<string, RollupPartials>();

  const into = (label: string): RollupPartials => {
    let partials = groups.get(label);
    if (!partials) {
      partials = emptyPartials();
      groups.set(label, partials);
    }
    return partials;
  };

  for (const bucket of buckets) {
    const label = truncateToGranularity(bucket.bucketStart, granularity);
    groups.set(label, mergePartials(into(label), bucket.partials));
  }

  for (const record of rawRecords) {
    const ts = record[tsField];
    if (typeof ts !== 'number') {
      continue;
    }
    const label = truncateToGranularity(ts, granularity);
    const value =
      metric.field !== undefined
        ? (record[metric.field] as JSONValue | undefined)
        : undefined;
    foldValueIntoPartials(into(label), ts, value);
  }

  return [...groups.entries()]
    .map(([date, partials]) => ({
      date,
      value: aggFromPartials(metric.fn, partials),
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}
