import type { SyncResult } from './connector';

export interface ChunkedSyncCursor<TPhase extends string, TPage> {
  phase: TPhase;
  page: TPage | null;
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
      const { items, next } = await fetchPage(phase, page, signal);
      await writeBatch(phase, items, page);
      if (next === null) {
        break;
      }
      page = next;
    }
  }

  return { done: true };
}
