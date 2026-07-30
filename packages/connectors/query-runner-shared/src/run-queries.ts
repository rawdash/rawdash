import {
  ClientBugError,
  type ConnectorLogger,
} from '@rawdash/connector-shared';
import type {
  MetricSample,
  StorageHandle,
  SyncOptions,
  SyncResult,
} from '@rawdash/core';

import { type QueryRow, projectRows } from './project';
import {
  DEFAULT_LOOKBACK_DAYS,
  DEFAULT_MAX_ROWS_PER_QUERY,
  DEFAULT_STATEMENT_TIMEOUT_MS,
  type QueryDefinition,
  type QueryRunnerSettings,
  resourceNameOf,
} from './query-config';
import { highestPlaceholder, stripTrailingSemicolon } from './sql-guard';

const MS_PER_DAY = 86_400_000;
const LATEST_WINDOW_MS = MS_PER_DAY;

export interface QueryRequest {
  queryId: string;
  sql: string;
  params: readonly unknown[];
  maxRows: number;
  statementTimeoutMs: number;
}

export interface QueryExecutor {
  run(
    request: QueryRequest,
    signal?: AbortSignal,
  ): Promise<readonly QueryRow[]>;
  close(): Promise<void>;
}

export interface SyncWindow {
  startMs: number;
  endMs: number;
}

export function computeSyncWindow(
  options: SyncOptions,
  settings: QueryRunnerSettings,
  now: number,
): SyncWindow {
  if (options.since) {
    const sinceMs = Date.parse(options.since);
    if (Number.isFinite(sinceMs)) {
      return { startMs: Math.min(sinceMs, now), endMs: now };
    }
  }
  if (options.mode === 'latest') {
    return { startMs: now - LATEST_WINDOW_MS, endMs: now };
  }
  const lookbackDays = settings.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  return { startMs: now - lookbackDays * MS_PER_DAY, endMs: now };
}

export function buildQueryRequest(
  query: QueryDefinition,
  settings: QueryRunnerSettings,
  window: SyncWindow,
): QueryRequest {
  const maxRows =
    query.maxRows ?? settings.maxRowsPerQuery ?? DEFAULT_MAX_ROWS_PER_QUERY;
  const statementTimeoutMs =
    query.statementTimeoutMs ??
    settings.statementTimeoutMs ??
    DEFAULT_STATEMENT_TIMEOUT_MS;
  const placeholders = highestPlaceholder(query.sql);
  const windowParams = [
    new Date(window.startMs).toISOString(),
    new Date(window.endMs).toISOString(),
  ];
  return {
    queryId: query.id,
    sql: `select * from (${stripTrailingSemicolon(query.sql)}) as rawdash_query limit ${maxRows + 1}`,
    params: windowParams.slice(0, Math.min(placeholders, windowParams.length)),
    maxRows,
    statementTimeoutMs,
  };
}

function metricReplaceWindow(samples: readonly MetricSample[]): {
  start: number;
  end: number;
} {
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  for (const sample of samples) {
    start = Math.min(start, sample.ts);
    end = Math.max(end, sample.ts);
  }
  return { start, end };
}

export interface RunQueriesOptions {
  settings: QueryRunnerSettings;
  executor: QueryExecutor;
  storage: StorageHandle;
  options: SyncOptions;
  logger: ConnectorLogger;
  now?: number;
  signal?: AbortSignal;
}

export async function runQueries({
  settings,
  executor,
  storage,
  options,
  logger,
  now = Date.now(),
  signal,
}: RunQueriesOptions): Promise<SyncResult> {
  const window = computeSyncWindow(options, settings, now);
  const requested = options.resources;
  const failures: Error[] = [];

  try {
    for (const query of settings.queries) {
      if (signal?.aborted) {
        return { done: false };
      }
      const resource = resourceNameOf(query);
      if (
        requested !== undefined &&
        requested.size > 0 &&
        !requested.has(resource)
      ) {
        logger.info('resource skipped', {
          resource,
          reason: 'not in the requested resource set',
        });
        continue;
      }

      const startedAt = now;
      const request = buildQueryRequest(query, settings, window);
      let rows: readonly QueryRow[];
      try {
        rows = await executor.run(request, signal);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        logger.warn('fetch page failed', {
          resource,
          page: 1,
          error: error.message,
        });
        failures.push(error);
        continue;
      }

      if (rows.length > request.maxRows) {
        const error = new ClientBugError(
          `Query "${query.id}" returned more than the configured row limit (${request.maxRows}). Aggregate in SQL or raise maxRows.`,
        );
        logger.warn('fetch page failed', {
          resource,
          page: 1,
          error: error.message,
        });
        failures.push(error);
        continue;
      }

      logger.info('fetched page', {
        resource,
        page: 1,
        items: rows.length,
      });

      const projected = projectRows(query, rows, now);
      if (projected.skipped > 0) {
        logger.warn('rows skipped', {
          resource,
          page: 1,
          error: `${projected.skipped} row(s) lacked a usable value/timestamp/id column`,
        });
      }

      try {
        if (query.shape === 'entities') {
          await storage.entities(projected.entities, { types: [resource] });
        } else if (projected.metrics.length > 0) {
          await storage.metrics(projected.metrics, {
            names: [resource],
            replaceWindow: metricReplaceWindow(projected.metrics),
          });
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        logger.warn('write batch failed', {
          resource,
          page: 1,
          error: error.message,
        });
        failures.push(error);
        continue;
      }

      logger.info('resource done', {
        resource,
        pages: 1,
        items:
          query.shape === 'entities'
            ? projected.entities.length
            : projected.metrics.length,
        duration_ms: Date.now() - startedAt,
      });
    }
  } finally {
    await executor.close();
  }

  if (failures.length > 0) {
    throw failures[0];
  }

  return { done: true };
}
