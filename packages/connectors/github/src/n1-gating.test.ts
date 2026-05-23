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

function defaultRoute(url: string): MockResponseInit {
  if (url.includes('/actions/runs')) {
    return { body: { workflow_runs: [] } };
  }
  if (url.includes('/stats/contributors')) {
    return { body: [] };
  }
  if (url.match(/\/repos\/[^/]+\/[^/]+$/)) {
    return {
      body: { stargazers_count: 0, forks_count: 0, subscribers_count: 0 },
    };
  }
  return { body: [] };
}

function makePR(number: number, updatedAt: string) {
  return {
    number,
    title: `PR ${number}`,
    state: 'open',
    draft: false,
    user: { login: 'alice' },
    created_at: updatedAt,
    updated_at: updatedAt,
  };
}

function makeDeployment(id: number, createdAt: string) {
  return {
    id,
    environment: 'production',
    ref: 'main',
    sha: 'abc123',
    creator: { login: 'alice' },
    created_at: createdAt,
  };
}

describe('GitHubConnector — N+1 gating and short-circuit', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('skips /reviews calls when pull_request_reviews is not in the resource allowlist', async () => {
    const prs = [
      makePR(1, '2026-05-20T00:00:00Z'),
      makePR(2, '2026-05-19T00:00:00Z'),
      makePR(3, '2026-05-18T00:00:00Z'),
    ];
    const spy = installFetchMock((url) => {
      if (url.match(/\/pulls(\?|$)/)) {
        return { body: prs };
      }
      return defaultRoute(url);
    });

    const storage = new InMemoryStorage();
    await buildConnector().sync(
      { mode: 'full', resources: ['pull_requests'] },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    const reviewCalls = spy.mock.calls.filter(([url]) =>
      String(url).includes('/reviews'),
    );
    expect(reviewCalls).toHaveLength(0);
  });

  it('still fetches /reviews when pull_request_reviews is in the allowlist', async () => {
    const prs = [makePR(1, '2026-05-20T00:00:00Z')];
    const spy = installFetchMock((url) => {
      if (url.includes('/reviews')) {
        return { body: [] };
      }
      if (url.match(/\/pulls(\?|$)/)) {
        return { body: prs };
      }
      return defaultRoute(url);
    });

    const storage = new InMemoryStorage();
    await buildConnector().sync(
      { mode: 'full', resources: ['pull_requests', 'pull_request_reviews'] },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    const reviewCalls = spy.mock.calls.filter(([url]) =>
      String(url).includes('/reviews'),
    );
    expect(reviewCalls).toHaveLength(1);
  });

  it('fetches /reviews by default (no allowlist set) for backward compatibility', async () => {
    const prs = [makePR(1, '2026-05-20T00:00:00Z')];
    const spy = installFetchMock((url) => {
      if (url.includes('/reviews')) {
        return { body: [] };
      }
      if (url.match(/\/pulls(\?|$)/)) {
        return { body: prs };
      }
      return defaultRoute(url);
    });

    const storage = new InMemoryStorage();
    await buildConnector().sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    const reviewCalls = spy.mock.calls.filter(([url]) =>
      String(url).includes('/reviews'),
    );
    expect(reviewCalls).toHaveLength(1);
  });

  it('skips /deployments/{id}/statuses calls when deployment_statuses is not in the allowlist', async () => {
    const deployments = [
      makeDeployment(1, '2026-05-20T00:00:00Z'),
      makeDeployment(2, '2026-05-19T00:00:00Z'),
    ];
    const spy = installFetchMock((url) => {
      if (url.match(/\/deployments(\?|$)/)) {
        return { body: deployments };
      }
      return defaultRoute(url);
    });

    const storage = new InMemoryStorage();
    await buildConnector().sync(
      { mode: 'full', resources: ['deployments'] },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    const statusCalls = spy.mock.calls.filter(([url]) =>
      String(url).includes('/statuses'),
    );
    expect(statusCalls).toHaveLength(0);
  });

  it('does not fetch /reviews for PRs whose updated_at is past the `since` cutoff', async () => {
    const since = '2026-05-15T00:00:00Z';
    const prs = [
      makePR(1, '2026-05-20T00:00:00Z'),
      makePR(2, '2026-05-18T00:00:00Z'),
      makePR(3, '2026-05-10T00:00:00Z'),
      makePR(4, '2026-05-05T00:00:00Z'),
    ];
    const spy = installFetchMock((url) => {
      if (url.includes('/reviews')) {
        return { body: [] };
      }
      if (url.match(/\/pulls(\?|$)/)) {
        return { body: prs };
      }
      return defaultRoute(url);
    });

    const storage = new InMemoryStorage();
    await buildConnector().sync(
      { mode: 'full', since },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    const reviewCalls = spy.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.includes('/reviews'));
    expect(reviewCalls).toHaveLength(2);
    expect(reviewCalls.some((u) => u.includes('/pulls/1/reviews'))).toBe(true);
    expect(reviewCalls.some((u) => u.includes('/pulls/2/reviews'))).toBe(true);
    expect(reviewCalls.some((u) => u.includes('/pulls/3/reviews'))).toBe(false);
    expect(reviewCalls.some((u) => u.includes('/pulls/4/reviews'))).toBe(false);
  });

  it('stops paginating /pulls once a full page is entirely past `since`', async () => {
    const since = '2026-05-15T00:00:00Z';
    const page1 = [
      makePR(10, '2026-05-20T00:00:00Z'),
      makePR(11, '2026-05-18T00:00:00Z'),
    ];
    const page2 = [
      makePR(20, '2026-05-10T00:00:00Z'),
      makePR(21, '2026-05-08T00:00:00Z'),
    ];
    const page3 = [makePR(30, '2026-05-01T00:00:00Z')];

    const linkHeader = (next: string) => `<${next}>; rel="next"`;
    const page2Url =
      'https://api.github.com/repos/rawdash/rawdash/pulls?page=2';
    const page3Url =
      'https://api.github.com/repos/rawdash/rawdash/pulls?page=3';

    const spy = installFetchMock((url) => {
      if (url.includes('/reviews')) {
        return { body: [] };
      }
      if (url === page3Url) {
        return { body: page3 };
      }
      if (url === page2Url) {
        return {
          body: page2,
          headers: { link: linkHeader(page3Url) },
        };
      }
      if (url.match(/\/pulls(\?|$)/)) {
        return {
          body: page1,
          headers: { link: linkHeader(page2Url) },
        };
      }
      return defaultRoute(url);
    });

    const storage = new InMemoryStorage();
    await buildConnector().sync(
      { mode: 'full', since },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    const pullCalls = spy.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.match(/\/pulls(\?|$)/));
    expect(pullCalls).toHaveLength(2);
    expect(pullCalls.some((u) => u === page3Url)).toBe(false);
  });
});
