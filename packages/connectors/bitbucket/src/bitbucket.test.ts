import { InMemoryStorage } from '@rawdash/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BitbucketConnector } from './bitbucket';

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

describe('BitbucketConnector — resource allowlist', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockImplementation((url: string | URL) => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.includes('/pullrequests')) {
        return Promise.resolve(mockJson({ values: [], next: null }));
      }
      if (u.includes('/pipelines')) {
        return Promise.resolve(mockJson({ values: [], next: null }));
      }
      return Promise.resolve(mockJson({ values: [], next: null }));
    });
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('skips phases for resources not in the allowlist', async () => {
    const connector = new BitbucketConnector(
      { workspace: 'demo-ws', repoSlugs: ['demo-repo'] },
      { username: 'janedoe', appPassword: 'ATBB-test' },
    );
    const storage = new InMemoryStorage();
    const handle = storage.getStorageHandle('bitbucket');

    const result = await connector.sync(
      {
        mode: 'full',
        resources: new Set(['pull_request']),
      },
      handle,
    );
    expect(result.done).toBe(true);

    const urls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('/pullrequests'))).toBe(true);
    expect(urls.some((u) => u.includes('/pipelines'))).toBe(false);
  });

  it('syncs all phases when no allowlist is given', async () => {
    const connector = new BitbucketConnector(
      { workspace: 'demo-ws', repoSlugs: ['demo-repo'] },
      { username: 'janedoe', appPassword: 'ATBB-test' },
    );
    const storage = new InMemoryStorage();
    const handle = storage.getStorageHandle('bitbucket');

    const result = await connector.sync({ mode: 'full' }, handle);
    expect(result.done).toBe(true);

    const urls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('/pullrequests'))).toBe(true);
    expect(urls.some((u) => u.includes('/pipelines'))).toBe(true);
  });

  it('returns done immediately when allowlist is empty', async () => {
    const connector = new BitbucketConnector(
      { workspace: 'demo-ws', repoSlugs: ['demo-repo'] },
      { username: 'janedoe', appPassword: 'ATBB-test' },
    );
    const storage = new InMemoryStorage();
    const handle = storage.getStorageHandle('bitbucket');

    const result = await connector.sync(
      { mode: 'full', resources: new Set<string>() },
      handle,
    );
    expect(result.done).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('iterates each configured repository on multi-repo phases', async () => {
    const connector = new BitbucketConnector(
      { workspace: 'demo-ws', repoSlugs: ['alpha', 'beta'] },
      { username: 'janedoe', appPassword: 'ATBB-test' },
    );
    const storage = new InMemoryStorage();
    const handle = storage.getStorageHandle('bitbucket');

    await connector.sync(
      { mode: 'full', resources: new Set(['pull_request']) },
      handle,
    );

    const urls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(
      urls.some((u) => u.includes('/repositories/demo-ws/alpha/pullrequests')),
    ).toBe(true);
    expect(
      urls.some((u) => u.includes('/repositories/demo-ws/beta/pullrequests')),
    ).toBe(true);
  });

  it('writes pipeline entities and matching pipeline_event rows', async () => {
    const pipeline = {
      uuid: '{abc-123}',
      build_number: 42,
      state: { name: 'COMPLETED', result: { name: 'SUCCESSFUL' } },
      target: {
        ref_name: 'main',
        commit: { hash: 'deadbeef' },
      },
      trigger: { type: 'pipeline_trigger_push' },
      created_on: '2026-05-01T00:00:00.000Z',
      completed_on: '2026-05-01T00:05:00.000Z',
      duration_in_seconds: 300,
    };
    fetchSpy.mockImplementation((url: string | URL) => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.includes('/pipelines')) {
        return Promise.resolve(mockJson({ values: [pipeline], next: null }));
      }
      return Promise.resolve(mockJson({ values: [], next: null }));
    });

    const connector = new BitbucketConnector(
      { workspace: 'demo-ws', repoSlugs: ['demo-repo'] },
      { username: 'janedoe', appPassword: 'ATBB-test' },
    );
    const storage = new InMemoryStorage();
    const handle = storage.getStorageHandle('bitbucket');

    await connector.sync(
      { mode: 'full', resources: new Set(['pipeline', 'pipeline_event']) },
      handle,
    );

    const pipelines = await handle.queryEntities({ type: 'pipeline' });
    expect(pipelines).toHaveLength(1);
    expect(pipelines[0]!.attributes.result).toBe('SUCCESSFUL');
    expect(pipelines[0]!.attributes.duration_ms).toBe(300_000);

    const events = await handle.queryEvents({ name: 'pipeline_event' });
    expect(events).toHaveLength(1);
    expect(events[0]!.start_ts).toBe(Date.parse('2026-05-01T00:00:00.000Z'));
    expect(events[0]!.end_ts).toBe(Date.parse('2026-05-01T00:05:00.000Z'));
  });

  it('emits one pipeline entity and event per uuid when a page repeats a pipeline', async () => {
    const first = {
      uuid: '{dup-1}',
      build_number: 7,
      state: { name: 'IN_PROGRESS', result: null },
      created_on: '2026-05-02T00:00:00.000Z',
      completed_on: null,
      duration_in_seconds: null,
    };
    const second = {
      uuid: '{dup-1}',
      build_number: 7,
      state: { name: 'COMPLETED', result: { name: 'SUCCESSFUL' } },
      created_on: '2026-05-02T00:00:00.000Z',
      completed_on: '2026-05-02T00:03:00.000Z',
      duration_in_seconds: 180,
    };
    fetchSpy.mockImplementation((url: string | URL) => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.includes('/pipelines')) {
        return Promise.resolve(
          mockJson({ values: [first, second], next: null }),
        );
      }
      return Promise.resolve(mockJson({ values: [], next: null }));
    });

    const connector = new BitbucketConnector(
      { workspace: 'demo-ws', repoSlugs: ['demo-repo'] },
      { username: 'janedoe', appPassword: 'ATBB-test' },
    );
    const storage = new InMemoryStorage();
    const handle = storage.getStorageHandle('bitbucket');

    await connector.sync(
      { mode: 'full', resources: new Set(['pipeline', 'pipeline_event']) },
      handle,
    );

    const pipelines = await handle.queryEntities({ type: 'pipeline' });
    expect(pipelines).toHaveLength(1);

    const events = await handle.queryEvents({ name: 'pipeline_event' });
    expect(events).toHaveLength(1);
  });

  it('does not wipe existing entities on an incremental sync', async () => {
    const pr = {
      id: 1,
      title: 'old pr',
      state: 'OPEN',
      created_on: '2026-01-01T00:00:00.000Z',
      updated_on: '2026-01-02T00:00:00.000Z',
    };
    fetchSpy.mockImplementation((url: string | URL) => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.includes('/pullrequests')) {
        if (u.includes('q=updated_on')) {
          return Promise.resolve(mockJson({ values: [], next: null }));
        }
        return Promise.resolve(mockJson({ values: [pr], next: null }));
      }
      return Promise.resolve(mockJson({ values: [], next: null }));
    });

    const connector = new BitbucketConnector(
      { workspace: 'demo-ws', repoSlugs: ['demo-repo'] },
      { username: 'janedoe', appPassword: 'ATBB-test' },
    );
    const storage = new InMemoryStorage();
    const handle = storage.getStorageHandle('bitbucket');

    await connector.sync(
      { mode: 'full', resources: new Set(['pull_request']) },
      handle,
    );
    expect(
      (await handle.queryEntities({ type: 'pull_request' })).map((e) => e.id),
    ).toEqual(['demo-ws/demo-repo:1']);

    await connector.sync(
      {
        mode: 'latest',
        since: '2026-05-01T00:00:00Z',
        resources: new Set(['pull_request']),
      },
      handle,
    );

    const stored = await handle.queryEntities({ type: 'pull_request' });
    expect(stored.map((e) => e.id)).toEqual(['demo-ws/demo-repo:1']);
  });
});

describe('BitbucketConnector — filter pushdown', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(mockJson({ values: [], next: null })),
      );
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function pullRequestUrl(): string {
    const urls = fetchSpy.mock.calls.map((c) => String(c[0]));
    const url = urls.find((u) => u.includes('/pullrequests'));
    expect(url).toBeDefined();
    return url!;
  }

  it('pushes a declared state filter to the pull requests query', async () => {
    const connector = new BitbucketConnector(
      { workspace: 'demo-ws', repoSlugs: ['demo-repo'] },
      { username: 'janedoe', appPassword: 'ATBB-test' },
    );
    const handle = new InMemoryStorage().getStorageHandle('bitbucket');
    await connector.sync(
      {
        mode: 'full',
        resources: new Set(['pull_request']),
        fetchSpecs: {
          pull_request: [
            { filter: [{ field: 'state', op: 'eq', value: 'MERGED' }] },
          ],
        },
      },
      handle,
    );
    expect(new URL(pullRequestUrl()).searchParams.get('state')).toBe('MERGED');
  });

  it('fetches all states when multiple specs target the resource', async () => {
    const connector = new BitbucketConnector(
      { workspace: 'demo-ws', repoSlugs: ['demo-repo'] },
      { username: 'janedoe', appPassword: 'ATBB-test' },
    );
    const handle = new InMemoryStorage().getStorageHandle('bitbucket');
    await connector.sync(
      {
        mode: 'full',
        resources: new Set(['pull_request']),
        fetchSpecs: {
          pull_request: [
            { filter: [{ field: 'state', op: 'eq', value: 'MERGED' }] },
            { filter: [{ field: 'state', op: 'eq', value: 'OPEN' }] },
          ],
        },
      },
      handle,
    );
    expect(new URL(pullRequestUrl()).searchParams.get('state')).toBe(
      'OPEN,MERGED,DECLINED,SUPERSEDED',
    );
  });
});
