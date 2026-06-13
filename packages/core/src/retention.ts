import type { FetchSpec } from './backfill-window';
import type {
  Distribution,
  Entity,
  Event,
  JSONValue,
  MetricSample,
  StorageHandle,
} from './connector';
import type { FilterClause, FilterCondition } from './filters';

export interface RetentionConfig {
  maxAge?: number;
  maxSize?: number;
  floor?: number;
  intervalMs?: number;
}

export interface RetentionSpec {
  fetchSpecs?: Record<string, FetchSpec[]>;
  watermarks?: Record<string, number>;
  gracePeriodMs?: number;
}

export interface RetentionDeletionPlan {
  events: Event[];
  metrics: MetricSample[];
  distributions: Distribution[];
  entities: Entity[];
}

export function selectForDeletion<T>(
  rows: T[],
  getTs: (row: T) => number,
  config: RetentionConfig,
  nowMs: number = Date.now(),
): T[] {
  const { maxAge, maxSize, floor = 0 } = config;

  if (maxAge === undefined && maxSize === undefined) {
    return [];
  }

  const toDelete: T[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (i < floor) {
      continue;
    }

    const overSize = maxSize !== undefined && i >= maxSize;
    const tooOld = maxAge !== undefined && getTs(row) < nowMs - maxAge;

    if (overSize || tooOld) {
      toDelete.push(row);
    }
  }

  return toDelete;
}

function matchesCondition(
  attributes: Record<string, JSONValue>,
  condition: FilterCondition,
): boolean {
  const value = attributes[condition.field];
  switch (condition.op) {
    case 'eq':
      return value === condition.value;
    case 'neq':
      return value !== condition.value;
    case 'gt':
      return (
        typeof value === 'number' &&
        typeof condition.value === 'number' &&
        value > condition.value
      );
    case 'gte':
      return (
        typeof value === 'number' &&
        typeof condition.value === 'number' &&
        value >= condition.value
      );
    case 'lt':
      return (
        typeof value === 'number' &&
        typeof condition.value === 'number' &&
        value < condition.value
      );
    case 'lte':
      return (
        typeof value === 'number' &&
        typeof condition.value === 'number' &&
        value <= condition.value
      );
    case 'contains':
      return (
        typeof value === 'string' && value.includes(String(condition.value))
      );
  }
}

function matchesFilter(
  attributes: Record<string, JSONValue>,
  filter: FilterClause[],
): boolean {
  return filter.every((clause) => {
    if ('or' in clause) {
      return clause.or.some((c) => matchesCondition(attributes, c));
    }
    return matchesCondition(attributes, clause);
  });
}

function isTimeSeriesRowInKeepSet(
  ts: number,
  attributes: Record<string, JSONValue>,
  specs: FetchSpec[] | undefined,
  watermark: number | undefined,
  nowMs: number,
): boolean {
  if (watermark === undefined || ts >= watermark) {
    return true;
  }
  if (!specs || specs.length === 0) {
    return false;
  }
  for (const spec of specs) {
    if (
      spec.requiredWindowMs !== undefined &&
      ts < nowMs - spec.requiredWindowMs
    ) {
      continue;
    }
    if (
      !spec.filter ||
      spec.filter.length === 0 ||
      matchesFilter(attributes, spec.filter)
    ) {
      return true;
    }
  }
  return false;
}

function isEntityInKeepSet(
  entity: Entity,
  specs: FetchSpec[] | undefined,
  gracePeriodMs: number,
  nowMs: number,
): boolean {
  if (entity.updated_at >= nowMs - gracePeriodMs) {
    return true;
  }
  if (!specs || specs.length === 0) {
    return false;
  }
  for (const spec of specs) {
    const filterMatches =
      !spec.filter ||
      spec.filter.length === 0 ||
      matchesFilter(entity.attributes, spec.filter);
    if (!filterMatches) {
      continue;
    }
    if (spec.requiredWindowMs === undefined) {
      return true;
    }
    if (entity.updated_at >= nowMs - spec.requiredWindowMs) {
      return true;
    }
  }
  return false;
}

export async function computeRetention(
  handle: StorageHandle,
  spec: RetentionSpec,
  nowMs: number = Date.now(),
): Promise<RetentionDeletionPlan> {
  const { fetchSpecs, watermarks, gracePeriodMs = 0 } = spec;

  const hasWatermarks = watermarks && Object.keys(watermarks).length > 0;
  const hasFetchSpecs = fetchSpecs && Object.keys(fetchSpecs).length > 0;

  if (!hasWatermarks && !hasFetchSpecs && gracePeriodMs === 0) {
    return { events: [], metrics: [], distributions: [], entities: [] };
  }

  const [events, metrics, distributions] = await Promise.all([
    handle.queryEvents({}),
    handle.queryMetrics({}),
    handle.queryDistributions({}),
  ]);

  const entityTypes = fetchSpecs ? Object.keys(fetchSpecs) : [];
  const entityBatches = await Promise.all(
    entityTypes.map((type) => handle.queryEntities({ type })),
  );

  const plan: RetentionDeletionPlan = {
    events: [],
    metrics: [],
    distributions: [],
    entities: [],
  };

  for (const event of events) {
    if (
      !isTimeSeriesRowInKeepSet(
        event.start_ts,
        event.attributes,
        fetchSpecs?.[event.name],
        watermarks?.[event.name],
        nowMs,
      )
    ) {
      plan.events.push(event);
    }
  }

  for (const metric of metrics) {
    if (
      !isTimeSeriesRowInKeepSet(
        metric.ts,
        metric.attributes,
        fetchSpecs?.[metric.name],
        watermarks?.[metric.name],
        nowMs,
      )
    ) {
      plan.metrics.push(metric);
    }
  }

  for (const dist of distributions) {
    if (
      !isTimeSeriesRowInKeepSet(
        dist.ts,
        dist.attributes,
        fetchSpecs?.[dist.name],
        watermarks?.[dist.name],
        nowMs,
      )
    ) {
      plan.distributions.push(dist);
    }
  }

  for (let i = 0; i < entityTypes.length; i++) {
    const entityType = entityTypes[i]!;
    const typeSpecs = fetchSpecs?.[entityType];
    const entities = entityBatches[i]!;
    for (const entity of entities) {
      if (!isEntityInKeepSet(entity, typeSpecs, gracePeriodMs, nowMs)) {
        plan.entities.push(entity);
      }
    }
  }

  return plan;
}
