import type { CachedWidget } from '@rawdash/core';
import { describe, expect, it, vi } from 'vitest';

import { http } from './http';

function widget(data: unknown): CachedWidget {
  return {
    widgetId: 'w1',
    connectorId: 'c1',
    data,
    cachedAt: '2026-05-23T00:00:00.000Z',
  };
}

function jsonResponse(body: unknown, etag: string | null): Response {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (etag) {
    headers['ETag'] = etag;
  }
  return new Response(JSON.stringify(body), { status: 200, headers });
}

describe('http getWidget ETag caching', () => {
  it('sends If-None-Match on subsequent fetches and returns cached body on 304', async () => {
    const fetchMock = vi.fn();
    const w = widget({ count: 1 });
    fetchMock.mockResolvedValueOnce(jsonResponse(w, '"etag-1"'));
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 304, headers: { ETag: '"etag-1"' } }),
    );

    const src = http({
      baseUrl: 'https://api',
      fetch: fetchMock as unknown as typeof fetch,
    });
    const first = await src.getWidget('main', 'w1');
    expect(first).toEqual(w);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstInit = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((firstInit.headers as Record<string, string>)['If-None-Match']).toBe(
      undefined,
    );

    const second = await src.getWidget('main', 'w1');
    expect(second).toEqual(w);
    const secondInit = fetchMock.mock.calls[1]![1] as RequestInit;
    expect(
      (secondInit.headers as Record<string, string>)['If-None-Match'],
    ).toBe('"etag-1"');
  });

  it('updates the cached ETag and body on 200', async () => {
    const fetchMock = vi.fn();
    const v1 = widget({ count: 1 });
    const v2 = widget({ count: 2 });
    fetchMock.mockResolvedValueOnce(jsonResponse(v1, '"e1"'));
    fetchMock.mockResolvedValueOnce(jsonResponse(v2, '"e2"'));
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 304, headers: { ETag: '"e2"' } }),
    );

    const src = http({
      baseUrl: 'https://api',
      fetch: fetchMock as unknown as typeof fetch,
    });
    await src.getWidget('main', 'w1');
    const second = await src.getWidget('main', 'w1');
    expect(second).toEqual(v2);
    const third = await src.getWidget('main', 'w1');
    expect(third).toEqual(v2);
    expect(
      (fetchMock.mock.calls[2]![1] as RequestInit).headers as Record<
        string,
        string
      >,
    ).toMatchObject({ 'If-None-Match': '"e2"' });
  });

  it('scopes the cache per (dashboardId, widgetId)', async () => {
    const fetchMock = vi.fn();
    const a = widget({ which: 'a' });
    const b = widget({ which: 'b' });
    fetchMock.mockResolvedValueOnce(jsonResponse(a, '"a-1"'));
    fetchMock.mockResolvedValueOnce(jsonResponse(b, '"b-1"'));
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 304, headers: { ETag: '"a-1"' } }),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 304, headers: { ETag: '"b-1"' } }),
    );

    const src = http({
      baseUrl: 'https://api',
      fetch: fetchMock as unknown as typeof fetch,
    });
    await src.getWidget('main', 'wA');
    await src.getWidget('main', 'wB');
    const headersA1 = (fetchMock.mock.calls[0]![1] as RequestInit)
      .headers as Record<string, string>;
    const headersB1 = (fetchMock.mock.calls[1]![1] as RequestInit)
      .headers as Record<string, string>;
    expect(headersA1['If-None-Match']).toBeUndefined();
    expect(headersB1['If-None-Match']).toBeUndefined();

    const second = await src.getWidget('main', 'wA');
    const third = await src.getWidget('main', 'wB');
    expect(second).toEqual(a);
    expect(third).toEqual(b);
    const headersA2 = (fetchMock.mock.calls[2]![1] as RequestInit)
      .headers as Record<string, string>;
    const headersB2 = (fetchMock.mock.calls[3]![1] as RequestInit)
      .headers as Record<string, string>;
    expect(headersA2['If-None-Match']).toBe('"a-1"');
    expect(headersB2['If-None-Match']).toBe('"b-1"');
  });
});
