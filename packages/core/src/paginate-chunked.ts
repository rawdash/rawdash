import type { ConnectorLogger, HttpErrorKind } from '@rawdash/connector-shared';

import type { SyncResult } from './connector';

export const DEFAULT_MAX_CHUNK_MS = 30_000;

const NON_RETRYABLE_KINDS: ReadonlySet<HttpErrorKind> = new Set([
  'auth',
  'client_bug',
]);

function isNonRetryableError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) {
    return false;
  }
  const kind = (err as { kind?: unknown }).kind;
  return (
    typeof kind === 'string' && NON_RETRYABLE_KINDS.has(kind as HttpErrorKind)
  );
}

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
  maxChunkMs?: number;
  pipeline?: boolean;
  now?: () => number;
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

function isAbort(signal: AbortSignal | undefined, err: unknown): boolean {
  return Boolean(
    signal?.aborted || (err instanceof Error && err.name === 'AbortError'),
  );
}

function swallow(p: Promise<unknown> | null): void {
  if (p) {
    void p.catch(() => {});
  }
}

export async function paginateChunked<TPhase extends string, TPage>(
  opts: ChunkedSyncOptions<TPhase, TPage>,
): Promise<SyncResult> {
  const {
    phases,
    cursor,
    maxChunkMs = DEFAULT_MAX_CHUNK_MS,
    pipeline,
    now = Date.now,
  } = opts;

  if (phases.length === 0) {
    return { done: true };
  }

  const resumeIdx = cursor ? phases.indexOf(cursor.phase) : -1;
  const hasKnownResumePhase = resumeIdx >= 0;
  const startIdx = hasKnownResumePhase ? resumeIdx : 0;
  const chunkStart = now();

  const resumeAfter = (
    i: number,
    phase: TPhase,
    next: TPage | null,
  ): ChunkedSyncCursor<TPhase, TPage> | null => {
    if (next !== null) {
      return { phase, page: next };
    }
    const nextPhase = phases[i + 1];
    return nextPhase ? { phase: nextPhase, page: null } : null;
  };

  const budgetReached = (): boolean => now() - chunkStart >= maxChunkMs;

  return pipeline
    ? runPipelined(opts, startIdx, hasKnownResumePhase, {
        resumeAfter,
        budgetReached,
        now,
      })
    : runSequential(opts, startIdx, hasKnownResumePhase, {
        resumeAfter,
        budgetReached,
        now,
      });
}

interface LoopHelpers<TPhase extends string, TPage> {
  resumeAfter: (
    i: number,
    phase: TPhase,
    next: TPage | null,
  ) => ChunkedSyncCursor<TPhase, TPage> | null;
  budgetReached: () => boolean;
  now: () => number;
}

async function runSequential<TPhase extends string, TPage>(
  opts: ChunkedSyncOptions<TPhase, TPage>,
  startIdx: number,
  hasKnownResumePhase: boolean,
  { resumeAfter, budgetReached, now }: LoopHelpers<TPhase, TPage>,
): Promise<SyncResult> {
  const { phases, cursor, signal, fetchPage, writeBatch, logger } = opts;

  for (let i = startIdx; i < phases.length; i++) {
    const phase = phases[i]!;
    let page: TPage | null =
      i === startIdx && hasKnownResumePhase ? cursor!.page : null;
    let pageCount = 0;
    let itemCount = 0;
    const phaseStart = now();

    while (true) {
      if (signal?.aborted) {
        return { done: false, cursor: { phase, page } };
      }
      pageCount += 1;
      let items: unknown[];
      let next: TPage | null;
      try {
        ({ items, next } = await fetchPage(phase, page, signal));
      } catch (err) {
        if (isAbort(signal, err)) {
          return { done: false, cursor: { phase, page } };
        }
        logger?.warn('fetch page failed', {
          resource: phase,
          page: pageCount,
          cursor: truncateCursor(page),
          error: err instanceof Error ? err.message : String(err),
        });
        if (isNonRetryableError(err)) {
          throw err;
        }
        return { done: false, cursor: { phase, page }, transientError: err };
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
        if (isAbort(signal, err)) {
          return { done: false, cursor: { phase, page } };
        }
        logger?.warn('write batch failed', {
          resource: phase,
          page: pageCount,
          cursor: truncateCursor(page),
          error: err instanceof Error ? err.message : String(err),
        });
        if (isNonRetryableError(err)) {
          throw err;
        }
        return { done: false, cursor: { phase, page }, transientError: err };
      }
      const resume = resumeAfter(i, phase, next);
      if (resume && budgetReached()) {
        logger?.info('chunk budget reached', {
          resource: phase,
          pages: pageCount,
          duration_ms: now() - phaseStart,
        });
        return { done: false, cursor: resume };
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
      duration_ms: now() - phaseStart,
    });
  }

  return { done: true };
}

async function runPipelined<TPhase extends string, TPage>(
  opts: ChunkedSyncOptions<TPhase, TPage>,
  startIdx: number,
  hasKnownResumePhase: boolean,
  { resumeAfter, budgetReached, now }: LoopHelpers<TPhase, TPage>,
): Promise<SyncResult> {
  const { phases, cursor, signal, fetchPage, writeBatch, logger } = opts;

  for (let i = startIdx; i < phases.length; i++) {
    const phase = phases[i]!;
    let page: TPage | null =
      i === startIdx && hasKnownResumePhase ? cursor!.page : null;
    if (signal?.aborted) {
      return { done: false, cursor: { phase, page } };
    }
    let pageCount = 0;
    let itemCount = 0;
    const phaseStart = now();
    let inflight: Promise<FetchPageResult<TPage>> = fetchPage(
      phase,
      page,
      signal,
    );

    while (true) {
      if (signal?.aborted) {
        swallow(inflight);
        return { done: false, cursor: { phase, page } };
      }
      let items: unknown[];
      let next: TPage | null;
      try {
        ({ items, next } = await inflight);
      } catch (err) {
        if (isAbort(signal, err)) {
          return { done: false, cursor: { phase, page } };
        }
        logger?.warn('fetch page failed', {
          resource: phase,
          page: pageCount + 1,
          cursor: truncateCursor(page),
          error: err instanceof Error ? err.message : String(err),
        });
        if (isNonRetryableError(err)) {
          throw err;
        }
        return { done: false, cursor: { phase, page }, transientError: err };
      }
      pageCount += 1;
      itemCount += items.length;
      logger?.info('fetched page', {
        resource: phase,
        page: pageCount,
        items: items.length,
        cursor: truncateCursor(page),
        next: truncateCursor(next),
      });
      const prefetch = next !== null ? fetchPage(phase, next, signal) : null;
      try {
        await writeBatch(phase, items, page);
      } catch (err) {
        swallow(prefetch);
        if (isAbort(signal, err)) {
          return { done: false, cursor: { phase, page } };
        }
        logger?.warn('write batch failed', {
          resource: phase,
          page: pageCount,
          cursor: truncateCursor(page),
          error: err instanceof Error ? err.message : String(err),
        });
        if (isNonRetryableError(err)) {
          throw err;
        }
        return { done: false, cursor: { phase, page }, transientError: err };
      }
      const resume = resumeAfter(i, phase, next);
      if (resume && budgetReached()) {
        swallow(prefetch);
        logger?.info('chunk budget reached', {
          resource: phase,
          pages: pageCount,
          duration_ms: now() - phaseStart,
        });
        return { done: false, cursor: resume };
      }
      if (next === null) {
        break;
      }
      page = next;
      inflight = prefetch!;
    }
    logger?.info('resource done', {
      resource: phase,
      pages: pageCount,
      items: itemCount,
      duration_ms: now() - phaseStart,
    });
  }

  return { done: true };
}
