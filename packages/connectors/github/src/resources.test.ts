import { InMemoryStorage } from '@rawdash/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GitHubConnector } from './github';

function mockJson(
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'application/json', ...headers }),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

describe('GitHubConnector — resource allowlist', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockImplementation((url: string | URL) => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.includes('/actions/runs')) {
        return Promise.resolve(mockJson({ workflow_runs: [] }));
      }
      if (u.includes('/pulls')) {
        return Promise.resolve(mockJson([]));
      }
      if (u.includes('/issues')) {
        return Promise.resolve(mockJson([]));
      }
      if (u.includes('/deployments')) {
        return Promise.resolve(mockJson([]));
      }
      if (u.includes('/releases')) {
        return Promise.resolve(mockJson([]));
      }
      if (u.includes('/stats/contributors')) {
        return Promise.resolve(mockJson([]));
      }
      return Promise.resolve(
        mockJson({
          stargazers_count: 1,
          forks_count: 0,
          subscribers_count: 0,
        }),
      );
    });
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('skips phases for resources not in the allowlist', async () => {
    const connector = new GitHubConnector({ owner: 'o', repo: 'r' });
    const storage = new InMemoryStorage();
    const handle = storage.getStorageHandle('github');

    const result = await connector.sync(
      {
        mode: 'full',
        resources: new Set(['repo', 'pull_request', 'issue', 'workflow_run']),
      },
      handle,
    );
    expect(result.done).toBe(true);

    const urls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('/deployments'))).toBe(false);
    expect(urls.some((u) => u.includes('/releases'))).toBe(false);
    expect(urls.some((u) => u.includes('/stats/contributors'))).toBe(false);
    expect(urls.some((u) => u.endsWith('/repos/o/r'))).toBe(true);
    expect(urls.some((u) => u.includes('/actions/runs'))).toBe(true);
    expect(urls.some((u) => u.includes('/pulls'))).toBe(true);
    expect(urls.some((u) => u.includes('/issues'))).toBe(true);
  });

  it('syncs all phases when no allowlist is given (back-compat)', async () => {
    const connector = new GitHubConnector({ owner: 'o', repo: 'r' });
    const storage = new InMemoryStorage();
    const handle = storage.getStorageHandle('github');

    const result = await connector.sync({ mode: 'full' }, handle);
    expect(result.done).toBe(true);

    const urls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('/deployments'))).toBe(true);
    expect(urls.some((u) => u.includes('/releases'))).toBe(true);
  });

  it('returns done immediately when allowlist is empty', async () => {
    const connector = new GitHubConnector({ owner: 'o', repo: 'r' });
    const storage = new InMemoryStorage();
    const handle = storage.getStorageHandle('github');

    const result = await connector.sync(
      { mode: 'full', resources: new Set<string>() },
      handle,
    );
    expect(result.done).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
