import { describe, expect, it, vi } from 'vitest';

import { paginateChunked } from './paginate-chunked';

type Phase = 'a' | 'b' | 'c';
const phases: readonly Phase[] = ['a', 'b', 'c'];

describe('paginateChunked', () => {
  it('iterates phases in declared order and returns done when all phases exhaust', async () => {
    const writes: Array<{ phase: Phase; items: unknown[] }> = [];
    const result = await paginateChunked<Phase, number>({
      phases,
      cursor: undefined,
      signal: undefined,
      fetchPage: async (phase, page) => {
        if (page === null) {
          return { items: [`${phase}-1`], next: 1 };
        }
        if (page < 2) {
          return { items: [`${phase}-${page + 1}`], next: page + 1 };
        }
        return { items: [`${phase}-end`], next: null };
      },
      writeBatch: async (phase, items) => {
        writes.push({ phase, items });
      },
    });

    expect(result).toEqual({ done: true });
    expect(writes.map((w) => w.phase)).toEqual([
      'a',
      'a',
      'a',
      'b',
      'b',
      'b',
      'c',
      'c',
      'c',
    ]);
  });

  it('resumes from the cursor phase and page', async () => {
    const seen: Array<{ phase: Phase; page: number | null }> = [];
    const result = await paginateChunked<Phase, number>({
      phases,
      cursor: { phase: 'b', page: 5 },
      signal: undefined,
      fetchPage: async (phase, page) => {
        seen.push({ phase, page });
        return { items: [], next: null };
      },
      writeBatch: async () => {},
    });

    expect(result).toEqual({ done: true });
    expect(seen).toEqual([
      { phase: 'b', page: 5 },
      { phase: 'c', page: null },
    ]);
  });

  it('returns a resumable cursor when the signal is aborted between pages', async () => {
    const controller = new AbortController();
    let calls = 0;
    const result = await paginateChunked<Phase, number>({
      phases,
      cursor: undefined,
      signal: controller.signal,
      fetchPage: async () => {
        calls += 1;
        if (calls === 2) {
          controller.abort();
        }
        return { items: [], next: calls };
      },
      writeBatch: async () => {},
    });

    expect(result).toEqual({
      done: false,
      cursor: { phase: 'a', page: 2 },
    });
  });

  it('returns a cursor with null page when aborted before the first fetch of a phase', async () => {
    const controller = new AbortController();
    const fetchPage = vi.fn(async () => ({ items: [], next: null }));

    controller.abort();
    const result = await paginateChunked<Phase, number>({
      phases,
      cursor: undefined,
      signal: controller.signal,
      fetchPage,
      writeBatch: async () => {},
    });

    expect(fetchPage).not.toHaveBeenCalled();
    expect(result).toEqual({
      done: false,
      cursor: { phase: 'a', page: null },
    });
  });

  it('passes the current page to writeBatch so the connector can detect the first page', async () => {
    const seen: Array<number | null> = [];
    await paginateChunked<Phase, number>({
      phases: ['a'],
      cursor: undefined,
      signal: undefined,
      fetchPage: async (_phase, page) => {
        if (page === null) {
          return { items: [], next: 1 };
        }
        if (page === 1) {
          return { items: [], next: 2 };
        }
        return { items: [], next: null };
      },
      writeBatch: async (_phase, _items, page) => {
        seen.push(page);
      },
    });

    expect(seen).toEqual([null, 1, 2]);
  });

  it('treats an unknown cursor phase as starting from the beginning', async () => {
    const seen: Phase[] = [];
    const result = await paginateChunked<Phase, number>({
      phases,
      cursor: { phase: 'zzz' as Phase, page: null },
      signal: undefined,
      fetchPage: async (phase) => {
        seen.push(phase);
        return { items: [], next: null };
      },
      writeBatch: async () => {},
    });

    expect(result).toEqual({ done: true });
    expect(seen).toEqual(['a', 'b', 'c']);
  });

  it('does not propagate a stale page when the cursor phase is unknown', async () => {
    const seen: Array<{ phase: Phase; page: number | null }> = [];
    const result = await paginateChunked<Phase, number>({
      phases,
      cursor: { phase: 'zzz' as Phase, page: 99 },
      signal: undefined,
      fetchPage: async (phase, page) => {
        seen.push({ phase, page });
        return { items: [], next: null };
      },
      writeBatch: async () => {},
    });

    expect(result).toEqual({ done: true });
    expect(seen).toEqual([
      { phase: 'a', page: null },
      { phase: 'b', page: null },
      { phase: 'c', page: null },
    ]);
  });

  it('returns done immediately for an empty phases list', async () => {
    const fetchPage = vi.fn(async () => ({ items: [], next: null }));
    const result = await paginateChunked<Phase, number>({
      phases: [],
      cursor: undefined,
      signal: undefined,
      fetchPage,
      writeBatch: async () => {},
    });

    expect(result).toEqual({ done: true });
    expect(fetchPage).not.toHaveBeenCalled();
  });
});
