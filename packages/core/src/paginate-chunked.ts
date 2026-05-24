import type { ConnectorLogger } from '@rawdash/connector-shared';

import type { SyncResult } from './connector';

export interface ChunkedSyncCursor<TPhase extends string, TPage> {
  phase: TPhase;
  page: TPage | null;
}

export function selectActivePhases<R extends string, P extends string>(
  resourceToPhase: (resource: R) => P,
  order: readonly P[],
  enabled: readonly R[] | undefined,
): P[] {
  if (!enabled || enabled.length === 0) {
    return [...order];
  }
  const want = new Set<P>();
  for (const r of enabled) {
    want.add(resourceToPhase(r));
  }
  return order.filter((p) => want.has(p));
}

export function makeChunkedCursorGuard<TPhase extends string>(
  phases: readonly TPhase[],
): (value: unknown) => value is ChunkedSyncCursor<TPhase, string> {
  const phaseSet = new Set<string>(phases);
  return (value: unknown): value is ChunkedSyncCursor<TPhase, string> => {
    if (typeof value !== 'object' || value === null) {
      return false;
    }
    const v = value as { phase?: unknown; page?: unknown };
    if (typeof v.phase !== 'string' || !phaseSet.has(v.phase)) {
      return false;
    }
    if (v.page !== null && typeof v.page !== 'string') {
      return false;
    }
    return true;
  };
}

export interface FetchPageResult<TPage> {
  items: unknown[];
  next: TPage | null;
}

export interface ChunkedSyncOptions<TPhase extends string, TPage> {
  phases: readonly TPhase[];
  cursor: ChunkedSyncCursor<TPhase, TPage> | undefined;
  signal: AbortSignal | undefined;
  fetchPage: (
    phase: TPhase,
    page: TPage | null,
    signal: AbortSignal | undefined,
  ) => Promise<FetchPageResult<TPage>>;
  writeBatch: (
    phase: TPhase,
    items: unknown[],
    page: TPage | null,
  ) => Promise<void>;
  logger?: ConnectorLogger;
}

function truncateCursor(page: unknown): string | undefined {
  if (page === null || page === undefined) {
    return undefined;
  }
  const s = typeof page === 'string' ? page : JSON.stringify(page);
  if (s.length <= 80) {
    return s;
  }
  return `${s.slice(0, 79)}…`;
}

export async function paginateChunked<TPhase extends string, TPage>(
  opts: ChunkedSyncOptions<TPhase, TPage>,
): Promise<SyncResult> {
  const { phases, cursor, signal, fetchPage, writeBatch, logger } = opts;

  if (phases.length === 0) {
    return { done: true };
  }

  const resumeIdx = cursor ? phases.indexOf(cursor.phase) : -1;
  const hasKnownResumePhase = resumeIdx >= 0;
  const startIdx = hasKnownResumePhase ? resumeIdx : 0;

  for (let i = startIdx; i < phases.length; i++) {
    const phase = phases[i]!;
    let page: TPage | null =
      i === startIdx && hasKnownResumePhase ? cursor!.page : null;
    let pageCount = 0;
    let itemCount = 0;
    const phaseStart = Date.now();

    while (true) {
      if (signal?.aborted) {
        return {
          done: false,
          cursor: { phase, page } satisfies ChunkedSyncCursor<TPhase, TPage>,
        };
      }
      pageCount += 1;
      let items: unknown[];
      let next: TPage | null;
      try {
        ({ items, next } = await fetchPage(phase, page, signal));
      } catch (err) {
        if (
          signal?.aborted ||
          (err instanceof Error && err.name === 'AbortError')
        ) {
          return {
            done: false,
            cursor: { phase, page } satisfies ChunkedSyncCursor<TPhase, TPage>,
          };
        }
        logger?.warn('fetch page failed', {
          resource: phase,
          page: pageCount,
          cursor: truncateCursor(page),
          error: err instanceof Error ? err.message : String(err),
        });
        return {
          done: false,
          cursor: { phase, page } satisfies ChunkedSyncCursor<TPhase, TPage>,
          transientError: err,
        };
      }
      itemCount += items.length;
      logger?.info('fetched page', {
        resource: phase,
        page: pageCount,
        items: items.length,
        cursor: truncateCursor(page),
        next: truncateCursor(next),
      });
      try {
        await writeBatch(phase, items, page);
      } catch (err) {
        if (
          signal?.aborted ||
          (err instanceof Error && err.name === 'AbortError')
        ) {
          return {
            done: false,
            cursor: { phase, page } satisfies ChunkedSyncCursor<TPhase, TPage>,
          };
        }
        logger?.warn('write batch failed', {
          resource: phase,
          page: pageCount,
          cursor: truncateCursor(page),
          error: err instanceof Error ? err.message : String(err),
        });
        return {
          done: false,
          cursor: { phase, page } satisfies ChunkedSyncCursor<TPhase, TPage>,
          transientError: err,
        };
      }
      if (next === null) {
        break;
      }
      page = next;
    }
    logger?.info('resource done', {
      resource: phase,
      pages: pageCount,
      items: itemCount,
      duration_ms: Date.now() - phaseStart,
    });
  }

  return { done: true };
}
