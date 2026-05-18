import { request } from './request';
import type { HttpRequest } from './types';

export function parseLinkHeader(header: string | null): Record<string, string> {
  if (!header) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const part of header.split(',')) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="([^"]+)"/);
    if (match) {
      result[match[2]!] = match[1]!;
    }
  }
  return result;
}

export async function* paginateLink<T>(
  initial: HttpRequest,
  parse: (body: unknown) => T[],
): AsyncIterable<T> {
  let next: string | null = initial.url;
  while (next) {
    const res: Awaited<ReturnType<typeof request>> = await request({
      ...initial,
      url: next,
    });
    for (const item of parse(res.body)) {
      yield item;
    }
    const links = parseLinkHeader(res.headers.get('link'));
    next = links['next'] ?? null;
  }
}

export async function* paginateCursor<T>(
  initial: HttpRequest,
  parse: (body: unknown) => { items: T[]; nextCursor: string | null },
  buildNext: (req: HttpRequest, cursor: string) => HttpRequest,
): AsyncIterable<T> {
  let req: HttpRequest = initial;
  while (true) {
    const res = await request(req);
    const { items, nextCursor } = parse(res.body);
    for (const item of items) {
      yield item;
    }
    if (!nextCursor) {
      return;
    }
    req = buildNext(initial, nextCursor);
  }
}

export async function* paginatePage<T>(
  initial: HttpRequest,
  parse: (body: unknown) => { items: T[]; hasMore: boolean },
  buildPage: (req: HttpRequest, page: number) => HttpRequest,
): AsyncIterable<T> {
  let page = 1;
  while (true) {
    const req = page === 1 ? initial : buildPage(initial, page);
    const res = await request(req);
    const { items, hasMore } = parse(res.body);
    for (const item of items) {
      yield item;
    }
    if (!hasMore || items.length === 0) {
      return;
    }
    page++;
  }
}
