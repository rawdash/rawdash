import { InMemoryStorage } from '@rawdash/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GitLabConnector } from './gitlab';

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

describe('GitLabConnector — resource allowlist', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockImplementation((url: string | URL) => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.match(/\/projects\/\d+\/merge_requests/)) {
        return Promise.resolve(mockJson([]));
      }
      if (u.match(/\/projects\/\d+\/pipelines/)) {
        return Promise.resolve(mockJson([]));
      }
      if (u.match(/\/projects\/\d+\/issues/)) {
        return Promise.resolve(mockJson([]));
      }
      if (u.match(/\/projects\/\d+\/releases/)) {
        return Promise.resolve(mockJson([]));
      }
      if (u.match(/\/projects\/\d+$/)) {
        return Promise.resolve(
          mockJson({
            id: 42,
            name: 'demo',
            path_with_namespace: 'group/demo',
            default_branch: 'main',
            web_url: 'https://gitlab.example.com/group/demo',
            created_at: '2026-01-01T00:00:00Z',
            last_activity_at: '2026-05-01T00:00:00Z',
            archived: false,
            visibility: 'private',
          }),
        );
      }
      return Promise.resolve(mockJson([]));
    });
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('skips phases for resources not in the allowlist', async () => {
    const connector = new GitLabConnector(
      { host: 'gitlab.example.com', projectIds: [42] },
      { apiToken: 'glpat-test' },
    );
    const storage = new InMemoryStorage();
    const handle = storage.getStorageHandle('gitlab');

    const result = await connector.sync(
      {
        mode: 'full',
        resources: new Set(['project', 'merge_request']),
      },
      handle,
    );
    expect(result.done).toBe(true);

    const urls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('/merge_requests'))).toBe(true);
    expect(urls.some((u) => u.match(/\/projects\/\d+$/))).toBe(true);
    expect(urls.some((u) => u.includes('/pipelines'))).toBe(false);
    expect(urls.some((u) => u.includes('/issues'))).toBe(false);
    expect(urls.some((u) => u.includes('/releases'))).toBe(false);
  });

  it('syncs all phases when no allowlist is given', async () => {
    const connector = new GitLabConnector(
      { host: 'gitlab.example.com', projectIds: [42] },
      { apiToken: 'glpat-test' },
    );
    const storage = new InMemoryStorage();
    const handle = storage.getStorageHandle('gitlab');

    const result = await connector.sync({ mode: 'full' }, handle);
    expect(result.done).toBe(true);

    const urls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('/merge_requests'))).toBe(true);
    expect(urls.some((u) => u.includes('/pipelines'))).toBe(true);
    expect(urls.some((u) => u.includes('/issues'))).toBe(true);
    expect(urls.some((u) => u.includes('/releases'))).toBe(true);
  });

  it('returns done immediately when allowlist is empty', async () => {
    const connector = new GitLabConnector(
      { host: 'gitlab.example.com', projectIds: [42] },
      { apiToken: 'glpat-test' },
    );
    const storage = new InMemoryStorage();
    const handle = storage.getStorageHandle('gitlab');

    const result = await connector.sync(
      { mode: 'full', resources: new Set<string>() },
      handle,
    );
    expect(result.done).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('iterates each configured project on multi-project phases', async () => {
    const connector = new GitLabConnector(
      { host: 'gitlab.example.com', projectIds: [42, 99] },
      { apiToken: 'glpat-test' },
    );
    const storage = new InMemoryStorage();
    const handle = storage.getStorageHandle('gitlab');

    await connector.sync(
      { mode: 'full', resources: new Set(['issue']) },
      handle,
    );

    const urls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('/projects/42/issues'))).toBe(true);
    expect(urls.some((u) => u.includes('/projects/99/issues'))).toBe(true);
  });

  it('discovers projects from groupIds and writes project entities', async () => {
    fetchSpy.mockImplementation((url: string | URL) => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.includes('/groups/7/projects')) {
        return Promise.resolve(
          mockJson([
            {
              id: 101,
              name: 'alpha',
              path_with_namespace: 'engineering/alpha',
              default_branch: 'main',
              web_url: 'https://gitlab.example.com/engineering/alpha',
              created_at: '2026-01-01T00:00:00Z',
              last_activity_at: '2026-05-01T00:00:00Z',
              archived: false,
              visibility: 'private',
            },
            {
              id: 102,
              name: 'beta',
              path_with_namespace: 'engineering/beta',
              default_branch: 'main',
              web_url: 'https://gitlab.example.com/engineering/beta',
              created_at: '2026-01-01T00:00:00Z',
              last_activity_at: '2026-05-01T00:00:00Z',
              archived: false,
              visibility: 'private',
            },
          ]),
        );
      }
      if (u.match(/\/projects\/\d+$/) || u.match(/\/projects\/\d+\//)) {
        return Promise.resolve(mockJson([]));
      }
      return Promise.resolve(mockJson([]));
    });

    const connector = new GitLabConnector(
      { host: 'gitlab.example.com', groupIds: [7] },
      { apiToken: 'glpat-test' },
    );
    const storage = new InMemoryStorage();
    const handle = storage.getStorageHandle('gitlab');

    await connector.sync(
      { mode: 'full', resources: new Set(['project']) },
      handle,
    );

    const stored = await handle.queryEntities({ type: 'project' });
    expect(stored.map((e) => e.id).sort()).toEqual(['101', '102']);
  });
});
