import type { Entity, JSONValue, MetricSample } from '@rawdash/core';

import { type QueryDefinition, resourceNameOf } from './query-config';

export type QueryRow = Readonly<Record<string, unknown>>;

export interface ProjectedRows {
  metrics: MetricSample[];
  entities: Entity[];
  skipped: number;
}

const DEFAULT_TS_COLUMNS = ['ts', 'bucket', 'day', 'date', 'time'] as const;
const DEFAULT_VALUE_COLUMNS = ['value', 'count', 'total', 'amount'] as const;
const DEFAULT_SERIES_COLUMNS = [
  'series',
  'label',
  'group',
  'bucket_label',
] as const;
const DEFAULT_ID_COLUMNS = ['id', 'entity_id', 'key'] as const;
const DEFAULT_UPDATED_AT_COLUMNS = ['updated_at', 'updatedat'] as const;

function pickColumn(
  row: QueryRow,
  explicit: string | undefined,
  candidates: readonly string[],
): string | undefined {
  if (explicit !== undefined) {
    return explicit;
  }
  return candidates.find((candidate) => candidate in row);
}

export function toNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function toEpochMs(value: unknown): number | null {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

export function toJsonValue(value: unknown): JSONValue {
  if (value === null || value === undefined) {
    return null;
  }
  if (
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  ) {
    return typeof value === 'number' && !Number.isFinite(value)
      ? String(value)
      : value;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (Array.isArray(value)) {
    return value.map(toJsonValue);
  }
  if (typeof value === 'object') {
    const out: Record<string, JSONValue> = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = toJsonValue(inner);
    }
    return out;
  }
  return String(value);
}

function seriesLabel(value: unknown): string {
  if (value === null || value === undefined) {
    return 'unknown';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

export function projectRows(
  query: QueryDefinition,
  rows: readonly QueryRow[],
  now: number,
): ProjectedRows {
  const name = resourceNameOf(query);
  const metrics: MetricSample[] = [];
  const entities: Entity[] = [];
  let skipped = 0;

  const considered = query.shape === 'stat' ? rows.slice(0, 1) : rows;

  for (const row of considered) {
    if (query.shape === 'entities') {
      const idColumn = pickColumn(row, query.columns?.id, DEFAULT_ID_COLUMNS);
      const rawId = idColumn === undefined ? undefined : row[idColumn];
      if (rawId === null || rawId === undefined || rawId === '') {
        skipped += 1;
        continue;
      }
      const updatedAtColumn = pickColumn(
        row,
        query.columns?.updatedAt,
        DEFAULT_UPDATED_AT_COLUMNS,
      );
      const updatedAt =
        updatedAtColumn === undefined
          ? null
          : toEpochMs(row[updatedAtColumn as string]);
      const attributes: Record<string, JSONValue> = {};
      for (const [column, value] of Object.entries(row)) {
        if (column === idColumn) {
          continue;
        }
        attributes[column] = toJsonValue(value);
      }
      entities.push({
        type: name,
        id: String(rawId),
        attributes,
        updated_at: updatedAt ?? now,
      });
      continue;
    }

    const valueColumn = pickColumn(
      row,
      query.columns?.value,
      singleColumnFallback(row, DEFAULT_VALUE_COLUMNS),
    );
    const value =
      valueColumn === undefined ? null : toNumber(row[valueColumn as string]);
    if (value === null) {
      skipped += 1;
      continue;
    }

    let ts = now;
    if (query.shape === 'timeseries') {
      const tsColumn = pickColumn(row, query.columns?.ts, DEFAULT_TS_COLUMNS);
      const parsed = tsColumn === undefined ? null : toEpochMs(row[tsColumn]);
      if (parsed === null) {
        skipped += 1;
        continue;
      }
      ts = parsed;
    } else if (query.columns?.ts !== undefined) {
      const parsed = toEpochMs(row[query.columns.ts]);
      if (parsed !== null) {
        ts = parsed;
      }
    }

    const seriesColumn = pickColumn(
      row,
      query.columns?.series,
      query.shape === 'distribution'
        ? [...DEFAULT_SERIES_COLUMNS, ...nonNumericColumns(row, valueColumn)]
        : DEFAULT_SERIES_COLUMNS,
    );
    const attributes: Record<string, JSONValue> = { queryId: query.id };
    if (seriesColumn !== undefined) {
      attributes.series = seriesLabel(row[seriesColumn]);
    }

    metrics.push({ name, ts, value, attributes });
  }

  return { metrics, entities, skipped };
}

function singleColumnFallback(
  row: QueryRow,
  candidates: readonly string[],
): readonly string[] {
  const columns = Object.keys(row);
  if (columns.length === 1) {
    return [columns[0]!, ...candidates];
  }
  return candidates;
}

function nonNumericColumns(
  row: QueryRow,
  valueColumn: string | undefined,
): string[] {
  return Object.keys(row).filter(
    (column) => column !== valueColumn && toNumber(row[column]) === null,
  );
}
