import {
  type InvariantViolation,
  type MockResponseInit,
  connectorResourceShapeViolations,
  installFetchMockAdvanced,
  runPropertySyncTest,
  entityStoreFor as sharedEntityStoreFor,
  eventStoreFor as sharedEventStoreFor,
} from '@rawdash/connector-test-utils';
import { InMemoryStorage } from '@rawdash/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { GitLabConnector } from './gitlab';

const CONNECTOR_ID = 'gitlab';
const PROJECT_ID = 42;

type StoredEntity = {
  type: string;
  id: string;
  attributes: Record<string, unknown>;
};

const installFetchMock = installFetchMockAdvanced;

const docShapeExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    GitLabConnector.resources,
    storage,
    connectorId,
  );

function eventStoreFor(storage: InMemoryStorage): Array<{ name: string }> {
  return sharedEventStoreFor<{ name: string }>(storage, CONNECTOR_ID);
}

function entityStoreFor(
  storage: InMemoryStorage,
): Map<string, Map<string, StoredEntity>> {
  return sharedEntityStoreFor<StoredEntity>(storage, CONNECTOR_ID);
}

function lastByKey<T>(items: T[], keyFn: (item: T) => string): Map<string, T> {
  const out = new Map<string, T>();
  for (const item of items) {
    out.set(keyFn(item), item);
  }
  return out;
}

function buildConnector(): GitLabConnector {
  return new GitLabConnector(
    { host: 'gitlab.example.com', projectIds: [PROJECT_ID] },
    { apiToken: 'glpat-test' },
  );
}

function safeDefaultResponse(url: string): MockResponseInit {
  if (url.match(/\/projects\/\d+\/merge_requests/)) {
    return { body: [] };
  }
  if (url.match(/\/projects\/\d+\/pipelines/)) {
    return { body: [] };
  }
  if (url.match(/\/projects\/\d+\/issues/)) {
    return { body: [] };
  }
  if (url.match(/\/projects\/\d+\/releases/)) {
    return { body: [] };
  }
  if (url.match(/\/projects\/\d+$/)) {
    return {
      body: {
        id: PROJECT_ID,
        name: 'demo',
        path_with_namespace: 'group/demo',
        default_branch: 'main',
        web_url: `https://gitlab.example.com/group/demo`,
        created_at: '2026-01-01T00:00:00Z',
        last_activity_at: '2026-05-01T00:00:00Z',
        archived: false,
        visibility: 'private',
      },
    };
  }
  return { body: [] };
}

describe('GitLabConnector property tests', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('merge_requests: sync upholds universal invariants for any valid API payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: z.infer<typeof GitLabConnector.schemas.merge_requests>,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const lastByIid = lastByKey(sample, (mr) => `${PROJECT_ID}:${mr.iid}`);
      const stored = entityStoreFor(storage).get('merge_request') ?? new Map();
      if (stored.size !== lastByIid.size) {
        violations.push({
          invariant: 'one merge_request entity per (project, iid)',
          location: 'merge_requests phase',
          detail: `expected ${lastByIid.size} entities, got ${stored.size}`,
        });
      }
      for (const [key, mr] of lastByIid) {
        const e = stored.get(key);
        if (!e) {
          violations.push({
            invariant: 'no data loss: every unique MR is stored',
            location: 'merge_requests phase',
            detail: `missing merge_request entity for ${key}`,
          });
          continue;
        }
        if (
          e.attributes.title !== mr.title ||
          e.attributes.state !== mr.state
        ) {
          violations.push({
            invariant: 'last-write-wins: stored attributes match latest copy',
            location: 'merge_requests phase',
            detail: `merge_request ${key} stored attrs do not match last input`,
          });
        }
      }
      return violations;
    };

    await runPropertySyncTest({
      connectorClass: GitLabConnector,
      resource: 'merge_requests',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [extra, docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock((url) => {
          if (url.match(/\/projects\/\d+\/merge_requests/)) {
            return { body: sample };
          }
          return safeDefaultResponse(url);
        });
        await buildConnector().sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('pipelines: sync upholds universal invariants for any valid API payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: z.infer<typeof GitLabConnector.schemas.pipelines>,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const lastById = lastByKey(sample, (p) => `${PROJECT_ID}:${p.id}`);
      const stored = entityStoreFor(storage).get('pipeline') ?? new Map();
      if (stored.size !== lastById.size) {
        violations.push({
          invariant: 'one pipeline entity per (project, pipeline id)',
          location: 'pipelines phase',
          detail: `expected ${lastById.size} entities, got ${stored.size}`,
        });
      }
      const events = eventStoreFor(storage).filter(
        (e) => e.name === 'pipeline_event',
      );
      if (events.length !== lastById.size) {
        violations.push({
          invariant: 'one pipeline_event per unique pipeline id',
          location: 'pipelines phase',
          detail: `expected ${lastById.size} events, got ${events.length}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest({
      connectorClass: GitLabConnector,
      resource: 'pipelines',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [extra, docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock((url) => {
          if (url.match(/\/projects\/\d+\/pipelines/)) {
            return { body: sample };
          }
          return safeDefaultResponse(url);
        });
        await buildConnector().sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('issues: sync upholds universal invariants for any valid API payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: z.infer<typeof GitLabConnector.schemas.issues>,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const lastByIid = lastByKey(sample, (i) => `${PROJECT_ID}:${i.iid}`);
      const stored = entityStoreFor(storage).get('issue') ?? new Map();
      if (stored.size !== lastByIid.size) {
        violations.push({
          invariant: 'one issue entity per (project, iid)',
          location: 'issues phase',
          detail: `expected ${lastByIid.size} entities, got ${stored.size}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest({
      connectorClass: GitLabConnector,
      resource: 'issues',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [extra, docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock((url) => {
          if (url.match(/\/projects\/\d+\/issues/)) {
            return { body: sample };
          }
          return safeDefaultResponse(url);
        });
        await buildConnector().sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('releases: sync upholds universal invariants for any valid API payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: z.infer<typeof GitLabConnector.schemas.releases>,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const lastByTag = lastByKey(sample, (r) => `${PROJECT_ID}:${r.tag_name}`);
      const stored = entityStoreFor(storage).get('release') ?? new Map();
      if (stored.size !== lastByTag.size) {
        violations.push({
          invariant: 'one release entity per (project, tag_name)',
          location: 'releases phase',
          detail: `expected ${lastByTag.size} entities, got ${stored.size}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest({
      connectorClass: GitLabConnector,
      resource: 'releases',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [extra, docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock((url) => {
          if (url.match(/\/projects\/\d+\/releases/)) {
            return { body: sample };
          }
          return safeDefaultResponse(url);
        });
        await buildConnector().sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  describe('since cutoff and pagination short-circuit', () => {
    function makeMR(iid: number, updatedAt: string) {
      return {
        id: iid * 1000,
        iid,
        project_id: PROJECT_ID,
        title: `MR ${iid}`,
        state: 'opened',
        author: { id: 1, username: 'alice' },
        source_branch: 'feat',
        target_branch: 'main',
        created_at: updatedAt,
        updated_at: updatedAt,
        merged_at: null,
        closed_at: null,
        web_url: `https://gitlab.example.com/group/demo/-/merge_requests/${iid}`,
      };
    }

    it('stops paginating merge_requests once a full page is entirely past `since`', async () => {
      const since = '2026-05-15T00:00:00Z';
      const page1 = [
        makeMR(10, '2026-05-20T00:00:00Z'),
        makeMR(11, '2026-05-18T00:00:00Z'),
      ];
      const page2 = [
        makeMR(20, '2026-05-10T00:00:00Z'),
        makeMR(21, '2026-05-08T00:00:00Z'),
      ];
      const page3 = [makeMR(30, '2026-05-01T00:00:00Z')];

      const linkHeader = (next: string) => `<${next}>; rel="next"`;
      const page2Url = `https://gitlab.example.com/api/v4/projects/${PROJECT_ID}/merge_requests?page=2`;
      const page3Url = `https://gitlab.example.com/api/v4/projects/${PROJECT_ID}/merge_requests?page=3`;

      const spy = installFetchMock((url) => {
        if (url === page3Url) {
          return { body: page3 };
        }
        if (url === page2Url) {
          return {
            body: page2,
            headers: { link: linkHeader(page3Url) },
          };
        }
        if (url.match(/\/projects\/\d+\/merge_requests/)) {
          return {
            body: page1,
            headers: { link: linkHeader(page2Url) },
          };
        }
        return safeDefaultResponse(url);
      });

      const storage = new InMemoryStorage();
      await buildConnector().sync(
        {
          mode: 'full',
          since,
          resources: new Set(['merge_request']),
        },
        storage.getStorageHandle(CONNECTOR_ID),
      );

      const mrCalls = spy.mock.calls
        .map(([url]) => String(url))
        .filter((url) => url.includes('/merge_requests'));
      expect(mrCalls.some((u) => u === page3Url)).toBe(false);
      expect(mrCalls).toHaveLength(2);
    });
  });
});
