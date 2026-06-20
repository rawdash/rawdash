import { eventStoreFor } from '@rawdash/connector-test-utils';
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

  it('does not wipe existing entities on an incremental sync', async () => {
    const issue = {
      id: 1,
      iid: 1,
      title: 'old issue',
      state: 'opened',
      labels: [],
      web_url: 'https://gitlab.example.com/group/demo/-/issues/1',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    };
    fetchSpy.mockImplementation((url: string | URL) => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.match(/\/projects\/\d+\/issues/)) {
        if (u.includes('updated_after')) {
          return Promise.resolve(mockJson([]));
        }
        return Promise.resolve(mockJson([issue]));
      }
      return Promise.resolve(mockJson([]));
    });

    const connector = new GitLabConnector(
      { host: 'gitlab.example.com', projectIds: [42] },
      { apiToken: 'glpat-test' },
    );
    const storage = new InMemoryStorage();
    const handle = storage.getStorageHandle('gitlab');

    await connector.sync(
      { mode: 'full', resources: new Set(['issue']) },
      handle,
    );
    expect(
      (await handle.queryEntities({ type: 'issue' })).map((e) => e.id),
    ).toEqual(['42:1']);

    await connector.sync(
      {
        mode: 'latest',
        since: '2026-05-01T00:00:00Z',
        resources: new Set(['issue']),
      },
      handle,
    );

    const stored = await handle.queryEntities({ type: 'issue' });
    expect(stored.map((e) => e.id)).toEqual(['42:1']);
  });
});

describe('GitLabConnector — pipeline detail enrichment', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('populates pipeline duration_ms and finished_at from the single-pipeline endpoint', async () => {
    const listPipeline = {
      id: 555,
      iid: 7,
      project_id: 42,
      status: 'success',
      ref: 'main',
      sha: 'abc123',
      source: 'push',
      web_url: 'https://gitlab.example.com/group/demo/-/pipelines/555',
      created_at: '2026-05-01T00:00:00Z',
      updated_at: '2026-05-01T00:10:00Z',
    };
    const detailPipeline = {
      ...listPipeline,
      started_at: '2026-05-01T00:01:00Z',
      finished_at: '2026-05-01T00:06:00Z',
      duration: 300,
    };

    const fetchSpy = vi.fn().mockImplementation((url: string | URL) => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.match(/\/projects\/\d+\/pipelines\/\d+/)) {
        return Promise.resolve(mockJson(detailPipeline));
      }
      if (u.match(/\/projects\/\d+\/pipelines/)) {
        return Promise.resolve(mockJson([listPipeline]));
      }
      return Promise.resolve(mockJson([]));
    });
    vi.stubGlobal('fetch', fetchSpy);

    const connector = new GitLabConnector(
      { host: 'gitlab.example.com', projectIds: [42] },
      { apiToken: 'glpat-test' },
    );
    const storage = new InMemoryStorage();
    const handle = storage.getStorageHandle('gitlab');

    await connector.sync(
      { mode: 'full', resources: new Set(['pipeline', 'pipeline_event']) },
      handle,
    );

    const finishedMs = new Date('2026-05-01T00:06:00Z').getTime();
    const [pipeline] = await handle.queryEntities({ type: 'pipeline' });
    expect(pipeline).toBeDefined();
    expect(pipeline!.attributes.duration_ms).toBe(300_000);
    expect(pipeline!.attributes.finished_at).toBe(finishedMs);

    const events = eventStoreFor<{
      name: string;
      end_ts: number;
      attributes: Record<string, unknown>;
    }>(storage, 'gitlab').filter((e) => e.name === 'pipeline_event');
    expect(events).toHaveLength(1);
    expect(events[0]!.end_ts).toBe(finishedMs);
    expect(events[0]!.attributes.duration_ms).toBe(300_000);

    const detailCalls = fetchSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((u) => /\/pipelines\/\d+/.test(u));
    expect(detailCalls).toHaveLength(1);
  });
});

describe('GitLabConnector — filter pushdown', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockImplementation(() => Promise.resolve(mockJson([])));
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function listUrl(fragment: string): URL {
    const url = fetchSpy.mock.calls
      .map((c) => String(c[0]))
      .find((u) => u.includes(fragment));
    expect(url).toBeDefined();
    return new URL(url!);
  }

  async function syncWith(
    resource: string,
    fetchSpecs: Record<string, { filter: unknown[] }[]>,
  ): Promise<void> {
    const connector = new GitLabConnector(
      { host: 'gitlab.example.com', projectIds: [42] },
      { apiToken: 'glpat-test' },
    );
    const handle = new InMemoryStorage().getStorageHandle('gitlab');
    await connector.sync(
      {
        mode: 'full',
        resources: new Set([resource]),
        fetchSpecs: fetchSpecs as never,
      },
      handle,
    );
  }

  it('pushes a merge request state filter', async () => {
    await syncWith('merge_request', {
      merge_request: [
        { filter: [{ field: 'state', op: 'eq', value: 'merged' }] },
      ],
    });
    expect(listUrl('/merge_requests').searchParams.get('state')).toBe('merged');
  });

  it('pushes an issue state filter', async () => {
    await syncWith('issue', {
      issue: [{ filter: [{ field: 'state', op: 'eq', value: 'closed' }] }],
    });
    expect(listUrl('/issues').searchParams.get('state')).toBe('closed');
  });

  it('pushes a pipeline status filter', async () => {
    await syncWith('pipeline', {
      pipeline: [{ filter: [{ field: 'status', op: 'eq', value: 'failed' }] }],
    });
    expect(listUrl('/pipelines').searchParams.get('status')).toBe('failed');
  });

  it('falls back to state=all when multiple specs target merge requests', async () => {
    await syncWith('merge_request', {
      merge_request: [
        { filter: [{ field: 'state', op: 'eq', value: 'merged' }] },
        { filter: [{ field: 'state', op: 'eq', value: 'opened' }] },
      ],
    });
    expect(listUrl('/merge_requests').searchParams.get('state')).toBe('all');
  });
});
