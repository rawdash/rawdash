import { describe, expect, it, vi } from 'vitest';

import {
  AuthError,
  ClientBugError,
  RateLimitError,
  TransientError,
  UpstreamBugError,
} from './errors';
import { request } from './request';
import type { FetchLike } from './types';
import { DEFAULT_USER_AGENT } from './version';

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

describe('request — defaults', () => {
  it('sends default User-Agent and Accept headers', async () => {
    const fetchSpy = vi
      .fn<FetchLike>()
      .mockResolvedValue(jsonResponse({ ok: true }));
    await request({ url: 'https://example.test/x' }, { fetch: fetchSpy });
    const init = fetchSpy.mock.calls[0]![1];
    const headers = init.headers as Record<string, string>;
    expect(headers['User-Agent']).toBe(DEFAULT_USER_AGENT);
    expect(headers['Accept']).toBe('application/json');
  });

  it('allows callers to override default headers', async () => {
    const fetchSpy = vi.fn<FetchLike>().mockResolvedValue(jsonResponse({}));
    await request(
      {
        url: 'https://example.test/x',
        headers: {
          'User-Agent': 'my-app/1.0',
          Accept: 'application/vnd.github+json',
        },
      },
      { fetch: fetchSpy },
    );
    const headers = fetchSpy.mock.calls[0]![1].headers as Record<
      string,
      string
    >;
    expect(headers['User-Agent']).toBe('my-app/1.0');
    expect(headers['Accept']).toBe('application/vnd.github+json');
  });

  it('parses JSON when content-type is application/json', async () => {
    const fetchSpy = vi
      .fn<FetchLike>()
      .mockResolvedValue(jsonResponse({ hello: 'world' }));
    const res = await request<{ hello: string }>(
      { url: 'https://example.test/x' },
      { fetch: fetchSpy },
    );
    expect(res.body).toEqual({ hello: 'world' });
  });
});

describe('request — error classification', () => {
  it('throws AuthError for 401', async () => {
    const fetchSpy = vi
      .fn<FetchLike>()
      .mockResolvedValue(new Response('nope', { status: 401 }));
    await expect(
      request(
        { url: 'https://x.test', retry: { maxAttempts: 1 } },
        { fetch: fetchSpy },
      ),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it('throws AuthError for 403', async () => {
    const fetchSpy = vi
      .fn<FetchLike>()
      .mockResolvedValue(new Response('nope', { status: 403 }));
    await expect(
      request(
        { url: 'https://x.test', retry: { maxAttempts: 1 } },
        { fetch: fetchSpy },
      ),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it('throws ClientBugError for 400', async () => {
    const fetchSpy = vi
      .fn<FetchLike>()
      .mockResolvedValue(new Response('bad', { status: 400 }));
    await expect(
      request(
        { url: 'https://x.test', retry: { maxAttempts: 1 } },
        { fetch: fetchSpy },
      ),
    ).rejects.toBeInstanceOf(ClientBugError);
  });

  it('throws RateLimitError for 429', async () => {
    const fetchSpy = vi
      .fn<FetchLike>()
      .mockResolvedValue(new Response('slow', { status: 429 }));
    await expect(
      request(
        { url: 'https://x.test', retry: { maxAttempts: 1 } },
        { fetch: fetchSpy },
      ),
    ).rejects.toBeInstanceOf(RateLimitError);
  });

  it('throws UpstreamBugError for 500 after retries exhausted', async () => {
    const fetchSpy = vi
      .fn<FetchLike>()
      .mockResolvedValue(new Response('boom', { status: 500 }));
    await expect(
      request(
        { url: 'https://x.test', retry: { maxAttempts: 1 } },
        { fetch: fetchSpy },
      ),
    ).rejects.toBeInstanceOf(UpstreamBugError);
  });

  it('wraps network errors as TransientError', async () => {
    const fetchSpy = vi
      .fn<FetchLike>()
      .mockRejectedValue(new Error('ECONNRESET'));
    await expect(
      request(
        { url: 'https://x.test', retry: { maxAttempts: 1 } },
        { fetch: fetchSpy },
      ),
    ).rejects.toBeInstanceOf(TransientError);
  });
});

describe('request — retry behavior', () => {
  it('retries on 500 and succeeds on the third attempt', async () => {
    const fetchSpy = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(new Response('e', { status: 500 }))
      .mockResolvedValueOnce(new Response('e', { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const res = await request(
      {
        url: 'https://x.test',
        retry: { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 2 },
      },
      { fetch: fetchSpy },
    );
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('does not retry 4xx auth/client errors', async () => {
    const fetchSpy = vi
      .fn<FetchLike>()
      .mockResolvedValue(new Response('e', { status: 401 }));
    await expect(
      request(
        { url: 'https://x.test', retry: { maxAttempts: 5, initialDelayMs: 1 } },
        { fetch: fetchSpy },
      ),
    ).rejects.toBeInstanceOf(AuthError);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('honors Retry-After numeric header on 429', async () => {
    const fetchSpy = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(
        new Response('slow', {
          status: 429,
          headers: { 'retry-after': '0' },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const res = await request(
      {
        url: 'https://x.test',
        retry: { maxAttempts: 2, initialDelayMs: 1, maxDelayMs: 2 },
      },
      { fetch: fetchSpy },
    );
    expect(res.status).toBe(200);
  });
});

describe('request — rate-limit policy', () => {
  it('exposes parsed rate-limit state on the response', async () => {
    const reset = Math.floor(Date.now() / 1000) + 60;
    const fetchSpy = vi.fn<FetchLike>().mockResolvedValue(
      jsonResponse(
        {},
        {
          headers: {
            'x-ratelimit-remaining': '42',
            'x-ratelimit-reset': String(reset),
          },
        },
      ),
    );
    const { githubRateLimit } = await import('./rate-limit');
    const res = await request(
      { url: 'https://x.test', rateLimit: githubRateLimit },
      { fetch: fetchSpy },
    );
    expect(res.rateLimitState?.remaining).toBe(42);
    expect(res.rateLimitState?.resetAt.getTime()).toBe(reset * 1000);
  });
});
