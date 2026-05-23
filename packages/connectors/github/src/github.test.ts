import { InMemoryStorage } from '@rawdash/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GitHubConnector } from './github';

const CONNECTOR_ID = 'github-actions';

type MockResponseInit = {
  body: unknown;
  status?: number;
  headers?: Record<string, string>;
};

function mockResponse({
  body,
  status = 200,
  headers = {},
}: MockResponseInit): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    headers: new Headers({
      'content-type': 'application/json',
      ...headers,
    }),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

function installFetchMock(
  routeBody: (url: string) => MockResponseInit,
): ReturnType<typeof vi.fn> {
  const spy = vi.fn().mockImplementation((url: string | URL) => {
    const u = typeof url === 'string' ? url : url.toString();
    return Promise.resolve(mockResponse(routeBody(u)));
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

function buildConnector(): GitHubConnector {
  return new GitHubConnector(
    { owner: 'rawdash', repo: 'rawdash' },
    { token: undefined },
  );
}

function emptyRepoRoutes(url: string): MockResponseInit {
  if (url.match(/\/repos\/[^/]+\/[^/]+$/)) {
    return {
      body: { stargazers_count: 0, forks_count: 0, subscribers_count: 0 },
    };
  }
  if (url.includes('/actions/runs')) {
    return { body: { workflow_runs: [] } };
  }
  if (url.includes('/stats/contributors')) {
    return { body: [] };
  }
  return { body: [] };
}

describe('GitHubConnector resource allowlist', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('skips /reviews calls when pull_request_reviews is not in the allowlist', async () => {
    const prs = [
      {
        number: 1,
        title: 'p1',
        state: 'open',
        draft: false,
        user: { login: 'a' },
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
      },
      {
        number: 2,
        title: 'p2',
        state: 'closed',
        draft: false,
        user: { login: 'b' },
        created_at: '2026-01-03T00:00:00Z',
        updated_at: '2026-01-04T00:00:00Z',
      },
    ];
    const fetchSpy = installFetchMock((url) => {
      if (url.match(/\/pulls(\?|$)/)) {
        return { body: prs };
      }
      return emptyRepoRoutes(url);
    });

    const storage = new InMemoryStorage();
    await buildConnector().sync(
      {
        mode: 'full',
        resources: new Set([
          'repo',
          'workflow_runs',
          'pull_requests',
          'issues',
          'deployments',
          'releases',
          'contributors',
        ]),
      },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    const reviewCalls = fetchSpy.mock.calls.filter(([url]) =>
      String(url).includes('/reviews'),
    );
    expect(reviewCalls).toHaveLength(0);
  });

  it('makes /reviews calls when pull_request_reviews is in the allowlist', async () => {
    const prs = [
      {
        number: 1,
        title: 'p1',
        state: 'open',
        draft: false,
        user: { login: 'a' },
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
      },
    ];
    const fetchSpy = installFetchMock((url) => {
      if (url.includes('/reviews')) {
        return { body: [] };
      }
      if (url.match(/\/pulls(\?|$)/)) {
        return { body: prs };
      }
      return emptyRepoRoutes(url);
    });

    const storage = new InMemoryStorage();
    await buildConnector().sync(
      {
        mode: 'full',
        resources: new Set(['pull_requests', 'pull_request_reviews']),
      },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    const reviewCalls = fetchSpy.mock.calls.filter(([url]) =>
      String(url).includes('/reviews'),
    );
    expect(reviewCalls.length).toBeGreaterThan(0);
  });

  it('skips /statuses calls when deployment_statuses is not in the allowlist', async () => {
    const deployments = [
      {
        id: 100,
        environment: 'prod',
        ref: 'main',
        sha: 'abc',
        creator: { login: 'a' },
        created_at: '2026-01-01T00:00:00Z',
      },
    ];
    const fetchSpy = installFetchMock((url) => {
      if (url.includes('/deployments')) {
        return { body: deployments };
      }
      return emptyRepoRoutes(url);
    });

    const storage = new InMemoryStorage();
    await buildConnector().sync(
      { mode: 'full', resources: new Set(['deployments']) },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    const statusCalls = fetchSpy.mock.calls.filter(([url]) =>
      String(url).includes('/statuses'),
    );
    expect(statusCalls).toHaveLength(0);
  });

  it('fetches reviews for all resources when no allowlist is set (backward compatible)', async () => {
    const prs = [
      {
        number: 1,
        title: 'p1',
        state: 'open',
        draft: false,
        user: { login: 'a' },
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
      },
    ];
    const fetchSpy = installFetchMock((url) => {
      if (url.includes('/reviews')) {
        return { body: [] };
      }
      if (url.match(/\/pulls(\?|$)/)) {
        return { body: prs };
      }
      return emptyRepoRoutes(url);
    });

    const storage = new InMemoryStorage();
    await buildConnector().sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    const reviewCalls = fetchSpy.mock.calls.filter(([url]) =>
      String(url).includes('/reviews'),
    );
    expect(reviewCalls.length).toBeGreaterThan(0);
  });
});

describe('GitHubConnector since short-circuit', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('stops paginating PRs once the last PR on a page is older than `since`', async () => {
    const since = '2026-03-01T00:00:00Z';
    const page1 = [
      {
        number: 10,
        title: 'recent',
        state: 'open',
        draft: false,
        user: { login: 'a' },
        created_at: '2026-04-01T00:00:00Z',
        updated_at: '2026-04-02T00:00:00Z',
      },
      {
        number: 9,
        title: 'old',
        state: 'closed',
        draft: false,
        user: { login: 'b' },
        created_at: '2025-12-01T00:00:00Z',
        updated_at: '2025-12-02T00:00:00Z',
      },
    ];
    let prFetches = 0;
    const fetchSpy = installFetchMock((url) => {
      if (url.match(/\/pulls(\?|$)/)) {
        prFetches++;
        return {
          body: page1,
          headers: {
            link: '<https://api.github.com/repos/rawdash/rawdash/pulls?page=2>; rel="next"',
          },
        };
      }
      return emptyRepoRoutes(url);
    });

    const storage = new InMemoryStorage();
    await buildConnector().sync(
      {
        mode: 'full',
        since,
        resources: new Set(['pull_requests']),
      },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    expect(prFetches).toBe(1);
    expect(
      fetchSpy.mock.calls.some(([url]) => String(url).includes('page=2')),
    ).toBe(false);
  });

  it('does not fetch reviews for PRs older than `since` (when reviews allowed)', async () => {
    const since = '2026-03-01T00:00:00Z';
    const prs = [
      {
        number: 10,
        title: 'recent',
        state: 'open',
        draft: false,
        user: { login: 'a' },
        created_at: '2026-04-01T00:00:00Z',
        updated_at: '2026-04-02T00:00:00Z',
      },
      {
        number: 9,
        title: 'old',
        state: 'closed',
        draft: false,
        user: { login: 'b' },
        created_at: '2025-12-01T00:00:00Z',
        updated_at: '2025-12-02T00:00:00Z',
      },
    ];
    const fetchSpy = installFetchMock((url) => {
      if (url.includes('/reviews')) {
        return { body: [] };
      }
      if (url.match(/\/pulls(\?|$)/)) {
        return { body: prs };
      }
      return emptyRepoRoutes(url);
    });

    const storage = new InMemoryStorage();
    await buildConnector().sync(
      {
        mode: 'full',
        since,
        resources: new Set(['pull_requests', 'pull_request_reviews']),
      },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    const reviewCalls = fetchSpy.mock.calls.filter(([url]) =>
      String(url).includes('/reviews'),
    );
    expect(reviewCalls).toHaveLength(1);
    expect(String(reviewCalls[0]?.[0])).toContain('/pulls/10/reviews');
  });
});
