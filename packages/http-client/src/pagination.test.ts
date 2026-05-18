import { describe, expect, it, vi } from 'vitest';

import {
  paginateCursor,
  paginateLink,
  paginatePage,
  parseLinkHeader,
} from './pagination';
import type { FetchLike } from './types';

describe('parseLinkHeader', () => {
  it('parses next/prev/last links from a GitHub-style Link header', () => {
    const h =
      '<https://api.example/x?page=2>; rel="next", <https://api.example/x?page=5>; rel="last"';
    const parsed = parseLinkHeader(h);
    expect(parsed.next).toBe('https://api.example/x?page=2');
    expect(parsed.last).toBe('https://api.example/x?page=5');
  });

  it('returns {} for null', () => {
    expect(parseLinkHeader(null)).toEqual({});
  });
});

function jsonResponse(
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('paginateLink', () => {
  it('follows the Link header until next is gone', async () => {
    const fetchSpy = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(
        jsonResponse([1, 2], {
          link: '<https://api.example/x?page=2>; rel="next"',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse([3, 4], {
          link: '<https://api.example/x?page=3>; rel="next"',
        }),
      )
      .mockResolvedValueOnce(jsonResponse([5]));

    const collected: number[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      for await (const item of paginateLink<number>(
        { url: 'https://api.example/x?page=1' },
        (body) => body as number[],
      )) {
        collected.push(item);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(collected).toEqual([1, 2, 3, 4, 5]);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});

describe('paginateCursor', () => {
  it('walks cursors and stops when nextCursor is null', async () => {
    const fetchSpy = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(
        jsonResponse({ items: ['a', 'b'], nextCursor: 'c1' }),
      )
      .mockResolvedValueOnce(jsonResponse({ items: ['c'], nextCursor: null }));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const result: string[] = [];
      for await (const item of paginateCursor<string>(
        { url: 'https://api.example/x' },
        (body) => body as { items: string[]; nextCursor: string | null },
        (req, cursor) => ({ ...req, url: `${req.url}?cursor=${cursor}` }),
      )) {
        result.push(item);
      }
      expect(result).toEqual(['a', 'b', 'c']);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('paginatePage', () => {
  it('walks pages and stops when hasMore is false', async () => {
    const fetchSpy = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({ items: [1, 2], hasMore: true }))
      .mockResolvedValueOnce(jsonResponse({ items: [3], hasMore: false }));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const result: number[] = [];
      for await (const item of paginatePage<number>(
        { url: 'https://api.example/x' },
        (body) => body as { items: number[]; hasMore: boolean },
        (req, page) => ({ ...req, url: `${req.url}?page=${page}` }),
      )) {
        result.push(item);
      }
      expect(result).toEqual([1, 2, 3]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
