import {
  AuthError,
  ClientBugError,
  TransientError,
} from '@rawdash/connector-shared';
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

  it('returns a resumable cursor with the transient error when fetchPage throws', async () => {
    const boom = new Error('Too many subrequests by single Worker invocation');
    let calls = 0;
    const writes: Array<{ phase: Phase; page: number | null }> = [];
    const result = await paginateChunked<Phase, number>({
      phases,
      cursor: undefined,
      signal: undefined,
      fetchPage: async (_phase, page) => {
        calls += 1;
        if (calls === 3) {
          throw boom;
        }
        return { items: [], next: (page ?? 0) + 1 };
      },
      writeBatch: async (phase, _items, page) => {
        writes.push({ phase, page });
      },
    });

    expect(result).toEqual({
      done: false,
      cursor: { phase: 'a', page: 2 },
      transientError: boom,
    });
    expect(writes).toEqual([
      { phase: 'a', page: null },
      { phase: 'a', page: 1 },
    ]);
  });

  it('re-throws an AuthError from fetchPage instead of returning it as transient', async () => {
    const boom = new AuthError('token revoked');
    await expect(
      paginateChunked<Phase, number>({
        phases,
        cursor: undefined,
        signal: undefined,
        fetchPage: async () => {
          throw boom;
        },
        writeBatch: async () => {},
      }),
    ).rejects.toBe(boom);
  });

  it('re-throws a ClientBugError from fetchPage instead of returning it as transient', async () => {
    const boom = new ClientBugError('repo not found');
    await expect(
      paginateChunked<Phase, number>({
        phases,
        cursor: undefined,
        signal: undefined,
        fetchPage: async () => {
          throw boom;
        },
        writeBatch: async () => {},
      }),
    ).rejects.toBe(boom);
  });

  it('re-throws a non-retryable error from writeBatch instead of returning it as transient', async () => {
    const boom = new AuthError('token revoked');
    await expect(
      paginateChunked<Phase, number>({
        phases,
        cursor: undefined,
        signal: undefined,
        fetchPage: async () => ({ items: [1], next: null }),
        writeBatch: async () => {
          throw boom;
        },
      }),
    ).rejects.toBe(boom);
  });

  it('still returns a resumable transient cursor for retryable HTTP errors', async () => {
    const boom = new TransientError('upstream hiccup');
    const result = await paginateChunked<Phase, number>({
      phases,
      cursor: undefined,
      signal: undefined,
      fetchPage: async () => {
        throw boom;
      },
      writeBatch: async () => {},
    });

    expect(result).toEqual({
      done: false,
      cursor: { phase: 'a', page: null },
      transientError: boom,
    });
  });

  it('re-throws a foreign error matched by its kind discriminator, not class identity', async () => {
    const boom = Object.assign(new Error('token revoked'), {
      kind: 'auth' as const,
    });
    await expect(
      paginateChunked<Phase, number>({
        phases,
        cursor: undefined,
        signal: undefined,
        fetchPage: async () => {
          throw boom;
        },
        writeBatch: async () => {},
      }),
    ).rejects.toBe(boom);
  });

  it('logs the failure before re-throwing a non-retryable error', async () => {
    const events: Array<{ level: string; event: string }> = [];
    const logger = {
      info: (event: string) => events.push({ level: 'info', event }),
      warn: (event: string) => events.push({ level: 'warn', event }),
    };
    await expect(
      paginateChunked<Phase, number>({
        phases: ['a'],
        cursor: undefined,
        signal: undefined,
        fetchPage: async () => {
          throw new ClientBugError('bad request');
        },
        writeBatch: async () => {},
        logger,
      }),
    ).rejects.toBeInstanceOf(ClientBugError);
    expect(
      events.some((e) => e.level === 'warn' && e.event === 'fetch page failed'),
    ).toBe(true);
  });

  it('does not classify an AbortError thrown by fetchPage as a transient error', async () => {
    const controller = new AbortController();
    const abortErr = Object.assign(new Error('aborted'), {
      name: 'AbortError',
    });
    const result = await paginateChunked<Phase, number>({
      phases,
      cursor: undefined,
      signal: controller.signal,
      fetchPage: async () => {
        controller.abort();
        throw abortErr;
      },
      writeBatch: async () => {},
    });

    expect(result).toEqual({
      done: false,
      cursor: { phase: 'a', page: null },
    });
  });

  it('does not call writeBatch when fetchPage throws on the first page of a phase', async () => {
    const boom = new Error('network');
    const writeBatch = vi.fn(async () => {});
    const result = await paginateChunked<Phase, number>({
      phases,
      cursor: undefined,
      signal: undefined,
      fetchPage: async () => {
        throw boom;
      },
      writeBatch,
    });

    expect(result).toEqual({
      done: false,
      cursor: { phase: 'a', page: null },
      transientError: boom,
    });
    expect(writeBatch).not.toHaveBeenCalled();
  });

  it('returns a resumable cursor with the transient error when writeBatch throws', async () => {
    const boom = new Error('Too many subrequests by single Worker invocation');
    let writeCalls = 0;
    const result = await paginateChunked<Phase, number>({
      phases,
      cursor: undefined,
      signal: undefined,
      fetchPage: async (_phase, page) => {
        return { items: [`item-${page ?? 0}`], next: (page ?? 0) + 1 };
      },
      writeBatch: async () => {
        writeCalls += 1;
        if (writeCalls === 3) {
          throw boom;
        }
      },
    });

    expect(result).toEqual({
      done: false,
      cursor: { phase: 'a', page: 2 },
      transientError: boom,
    });
  });

  it('does not classify an AbortError thrown by writeBatch as a transient error', async () => {
    const controller = new AbortController();
    const abortErr = Object.assign(new Error('aborted'), {
      name: 'AbortError',
    });
    const result = await paginateChunked<Phase, number>({
      phases,
      cursor: undefined,
      signal: controller.signal,
      fetchPage: async () => ({ items: [], next: 1 }),
      writeBatch: async () => {
        controller.abort();
        throw abortErr;
      },
    });

    expect(result).toEqual({
      done: false,
      cursor: { phase: 'a', page: null },
    });
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

  it('emits structured per-page and per-phase logs when a logger is provided', async () => {
    const events: Array<{
      level: 'info' | 'warn';
      event: string;
      fields?: Record<string, unknown>;
    }> = [];
    const logger = {
      info: (event: string, fields?: Record<string, unknown>) =>
        events.push({ level: 'info', event, fields }),
      warn: (event: string, fields?: Record<string, unknown>) =>
        events.push({ level: 'warn', event, fields }),
    };
    await paginateChunked<Phase, number>({
      phases: ['a'],
      cursor: undefined,
      signal: undefined,
      fetchPage: async (_phase, page) => {
        if (page === null) {
          return { items: [1, 2], next: 1 };
        }
        return { items: [3], next: null };
      },
      writeBatch: async () => {},
      logger,
    });
    const infos = events.filter((e) => e.level === 'info');
    expect(infos.map((e) => e.event)).toEqual([
      'fetched page',
      'fetched page',
      'resource done',
    ]);
    expect(infos[0]!.fields).toMatchObject({
      resource: 'a',
      page: 1,
      items: 2,
    });
    expect(infos[2]!.fields).toMatchObject({
      resource: 'a',
      pages: 2,
      items: 3,
    });
    expect(infos[2]!.fields).toHaveProperty('duration_ms');
  });

  it('emits a warn log when fetchPage throws a non-abort error', async () => {
    const events: Array<{ level: string; event: string }> = [];
    const logger = {
      info: (event: string) => events.push({ level: 'info', event }),
      warn: (event: string) => events.push({ level: 'warn', event }),
    };
    const result = await paginateChunked<Phase, number>({
      phases: ['a'],
      cursor: undefined,
      signal: undefined,
      fetchPage: async () => {
        throw new Error('boom');
      },
      writeBatch: async () => {},
      logger,
    });
    expect(result.done).toBe(false);
    expect(
      events.some((e) => e.level === 'warn' && e.event === 'fetch page failed'),
    ).toBe(true);
  });

  describe('time budget', () => {
    it('yields a resumable cursor for the next page once the budget is reached', async () => {
      let clock = 0;
      const writes: Array<number | null> = [];
      const result = await paginateChunked<Phase, number>({
        phases: ['a'],
        cursor: undefined,
        signal: undefined,
        maxChunkMs: 50,
        now: () => clock,
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
          writes.push(page);
          clock += 100;
        },
      });

      expect(result).toEqual({ done: false, cursor: { phase: 'a', page: 1 } });
      expect(writes).toEqual([null]);
    });

    it('yields a cursor at the next phase boundary when the budget is reached on the last page of a phase', async () => {
      let clock = 0;
      const result = await paginateChunked<Phase, number>({
        phases: ['a', 'b'],
        cursor: undefined,
        signal: undefined,
        maxChunkMs: 50,
        now: () => clock,
        fetchPage: async () => ({ items: [], next: null }),
        writeBatch: async () => {
          clock += 100;
        },
      });

      expect(result).toEqual({
        done: false,
        cursor: { phase: 'b', page: null },
      });
    });

    it('does not yield when the final page of the final phase completes within budget tracking', async () => {
      let clock = 0;
      const result = await paginateChunked<Phase, number>({
        phases: ['a'],
        cursor: undefined,
        signal: undefined,
        maxChunkMs: 50,
        now: () => clock,
        fetchPage: async () => ({ items: [], next: null }),
        writeBatch: async () => {
          clock += 100;
        },
      });

      expect(result).toEqual({ done: true });
    });
  });

  describe('pipeline', () => {
    it('iterates phases in order and returns done', async () => {
      const writes: Array<{ phase: Phase; page: number | null }> = [];
      const result = await paginateChunked<Phase, number>({
        phases,
        cursor: undefined,
        signal: undefined,
        pipeline: true,
        fetchPage: async (_phase, page) => {
          if (page === null) {
            return { items: [], next: 1 };
          }
          if (page === 1) {
            return { items: [], next: null };
          }
          return { items: [], next: null };
        },
        writeBatch: async (phase, _items, page) => {
          writes.push({ phase, page });
        },
      });

      expect(result).toEqual({ done: true });
      expect(writes).toEqual([
        { phase: 'a', page: null },
        { phase: 'a', page: 1 },
        { phase: 'b', page: null },
        { phase: 'b', page: 1 },
        { phase: 'c', page: null },
        { phase: 'c', page: 1 },
      ]);
    });

    it('prefetches the next page while the current page is being written', async () => {
      const calls: string[] = [];
      const result = await paginateChunked<Phase, number>({
        phases: ['a'],
        cursor: undefined,
        signal: undefined,
        pipeline: true,
        fetchPage: async (_phase, page) => {
          calls.push(`fetch:${page}`);
          if (page === null) {
            return { items: [], next: 1 };
          }
          return { items: [], next: null };
        },
        writeBatch: async (_phase, _items, page) => {
          calls.push(`write:${page}`);
          if (page === null) {
            await new Promise((r) => setTimeout(r, 0));
          }
        },
      });

      expect(result).toEqual({ done: true });
      expect(calls).toEqual(['fetch:null', 'fetch:1', 'write:null', 'write:1']);
    });

    it('resumes from the cursor phase and page', async () => {
      const seen: Array<{ phase: Phase; page: number | null }> = [];
      const result = await paginateChunked<Phase, number>({
        phases,
        cursor: { phase: 'b', page: 5 },
        signal: undefined,
        pipeline: true,
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
        pipeline: true,
        fetchPage: async () => {
          calls += 1;
          if (calls === 2) {
            controller.abort();
          }
          return { items: [], next: calls };
        },
        writeBatch: async () => {},
      });

      expect(result.done).toBe(false);
      expect(result.cursor).toEqual({ phase: 'a', page: 1 });
    });

    it('does not call fetchPage when aborted before the first fetch of a phase', async () => {
      const controller = new AbortController();
      const fetchPage = vi.fn(async () => ({ items: [], next: null }));
      controller.abort();
      const result = await paginateChunked<Phase, number>({
        phases,
        cursor: undefined,
        signal: controller.signal,
        pipeline: true,
        fetchPage,
        writeBatch: async () => {},
      });

      expect(fetchPage).not.toHaveBeenCalled();
      expect(result).toEqual({
        done: false,
        cursor: { phase: 'a', page: null },
      });
    });

    it('returns a resumable cursor with the transient error when fetchPage throws', async () => {
      const boom = new Error('boom');
      const result = await paginateChunked<Phase, number>({
        phases: ['a'],
        cursor: undefined,
        signal: undefined,
        pipeline: true,
        fetchPage: async () => {
          throw boom;
        },
        writeBatch: async () => {},
      });

      expect(result).toEqual({
        done: false,
        cursor: { phase: 'a', page: null },
        transientError: boom,
      });
    });

    it('re-throws a non-retryable error from fetchPage', async () => {
      const boom = new AuthError('token revoked');
      await expect(
        paginateChunked<Phase, number>({
          phases: ['a'],
          cursor: undefined,
          signal: undefined,
          pipeline: true,
          fetchPage: async () => {
            throw boom;
          },
          writeBatch: async () => {},
        }),
      ).rejects.toBe(boom);
    });

    it('yields a resumable cursor when the time budget is reached', async () => {
      let clock = 0;
      const result = await paginateChunked<Phase, number>({
        phases: ['a'],
        cursor: undefined,
        signal: undefined,
        pipeline: true,
        maxChunkMs: 50,
        now: () => clock,
        fetchPage: async (_phase, page) => {
          if (page === null) {
            return { items: [], next: 1 };
          }
          if (page === 1) {
            return { items: [], next: 2 };
          }
          return { items: [], next: null };
        },
        writeBatch: async () => {
          clock += 100;
        },
      });

      expect(result).toEqual({ done: false, cursor: { phase: 'a', page: 1 } });
    });
  });
});
