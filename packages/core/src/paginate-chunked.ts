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
}

export async function paginateChunked<TPhase extends string, TPage>(
  opts: ChunkedSyncOptions<TPhase, TPage>,
): Promise<SyncResult> {
  const { phases, cursor, signal, fetchPage, writeBatch } = opts;

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

    while (true) {
      if (signal?.aborted) {
        return {
          done: false,
          cursor: { phase, page } satisfies ChunkedSyncCursor<TPhase, TPage>,
        };
      }
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
        return {
          done: false,
          cursor: { phase, page } satisfies ChunkedSyncCursor<TPhase, TPage>,
          transientError: err,
        };
      }
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
  }

  return { done: true };
}
