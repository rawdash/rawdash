import { InMemoryStorage } from '@rawdash/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GitHubConnector } from './github';

const REPO_ID = '868501336';
const OWNER = 'Smirk-Health';
const REPO = 'monorepo';

function numericIdUrl(resource: string, page: number): string {
  return `https://api.github.com/repositories/${REPO_ID}/${resource}?per_page=100&page=${page}`;
}

function canonicalUrl(
  owner: string,
  repo: string,
  resource: string,
  page: number,
): string {
  return `https://api.github.com/repos/${owner}/${repo}/${resource}?per_page=100&page=${page}`;
}

function mockJsonWithLink(body: unknown, nextUrl: string | null): Response {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (nextUrl) {
    headers['link'] = `<${nextUrl}>; rel="next"`;
  }
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers(headers),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

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

describe('GitHubConnector — numeric repo ID cursor resume', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockImplementation((url: string | URL) => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.includes('/actions/runs')) {
        const urlObj = new URL(u);
        const page = Number(urlObj.searchParams.get('page') ?? 1);
        const hasMore = page < 3;
        const next = hasMore ? numericIdUrl('actions/runs', page + 1) : null;
        const run = {
          id: page,
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
          name: `run-${page}`,
          head_branch: 'main',
          status: 'completed',
          conclusion: 'success',
          run_attempt: 1,
          actor: { login: 'user' },
        };
        return Promise.resolve(
          mockJsonWithLink({ workflow_runs: [run] }, next),
        );
      }
      if (u.includes('/pulls')) {
        return Promise.resolve(mockJsonWithLink([], null));
      }
      if (u.includes('/issues')) {
        return Promise.resolve(mockJsonWithLink([], null));
      }
      if (u.includes('/deployments')) {
        return Promise.resolve(mockJsonWithLink([], null));
      }
      if (u.includes('/releases')) {
        return Promise.resolve(mockJsonWithLink([], null));
      }
      if (u.includes('/stats/contributors')) {
        return Promise.resolve(mockJsonWithLink([], null));
      }
      return Promise.resolve(
        mockJsonWithLink(
          { stargazers_count: 0, forks_count: 0, subscribers_count: 0 },
          null,
        ),
      );
    });
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('resumes from the correct page when the saved cursor uses the numeric repo ID URL form', async () => {
    const connector = new GitHubConnector({ owner: OWNER, repo: REPO });
    const storage = new InMemoryStorage();
    const handle = storage.getStorageHandle('github');

    const savedCursor = {
      phase: 'workflow_runs',
      page: numericIdUrl('actions/runs', 2),
    };

    const result = await connector.sync(
      {
        mode: 'full',
        cursor: savedCursor,
        resources: new Set(['workflow_run']),
      },
      handle,
    );

    const urls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(urls[0]).toBe(numericIdUrl('actions/runs', 2));
    expect(result.done).toBe(true);
  });

  it('also accepts the canonical /repos/owner/repo/ cursor form', async () => {
    const connector = new GitHubConnector({ owner: OWNER, repo: REPO });
    const storage = new InMemoryStorage();
    const handle = storage.getStorageHandle('github');

    const savedCursor = {
      phase: 'workflow_runs',
      page: canonicalUrl(OWNER, REPO, 'actions/runs', 2),
    };

    const result = await connector.sync(
      {
        mode: 'full',
        cursor: savedCursor,
        resources: new Set(['workflow_run']),
      },
      handle,
    );

    const urls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(urls[0]).toBe(canonicalUrl(OWNER, REPO, 'actions/runs', 2));
    expect(result.done).toBe(true);
  });

  it('rejects a cursor URL from an unrecognised host and restarts from page 1', async () => {
    const connector = new GitHubConnector({ owner: OWNER, repo: REPO });
    const storage = new InMemoryStorage();
    const handle = storage.getStorageHandle('github');

    const savedCursor = {
      phase: 'workflow_runs',
      page: 'https://evil.example.com/repositories/1/actions/runs?page=2',
    };

    await connector.sync(
      {
        mode: 'full',
        cursor: savedCursor,
        resources: new Set(['workflow_run']),
      },
      handle,
    );

    const urls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(urls[0]).toContain('/actions/runs');
    expect(urls[0]).not.toContain('evil.example.com');
  });
});
