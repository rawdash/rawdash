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

import { BitbucketConnector } from './bitbucket';

const CONNECTOR_ID = 'bitbucket';
const WORKSPACE = 'demo-ws';
const REPO_SLUG = 'demo-repo';

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
    BitbucketConnector.resources,
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

function buildConnector(): BitbucketConnector {
  return new BitbucketConnector(
    { workspace: WORKSPACE, repoSlugs: [REPO_SLUG] },
    { username: 'janedoe', appPassword: 'ATBB-test' },
  );
}

function safeDefaultResponse(url: string): MockResponseInit {
  if (url.includes('/pullrequests')) {
    return { body: { values: [], next: null } };
  }
  if (url.includes('/pipelines')) {
    return { body: { values: [], next: null } };
  }
  return { body: { values: [], next: null } };
}

describe('BitbucketConnector property tests', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('pull_requests: sync upholds universal invariants for any valid API payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: z.infer<typeof BitbucketConnector.schemas.pull_requests>,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const lastById = lastByKey(
        sample.values,
        (pr) => `${WORKSPACE}/${REPO_SLUG}:${pr.id}`,
      );
      const stored = entityStoreFor(storage).get('pull_request') ?? new Map();
      if (stored.size !== lastById.size) {
        violations.push({
          invariant: 'one pull_request entity per (workspace, repo, id)',
          location: 'pull_requests phase',
          detail: `expected ${lastById.size} entities, got ${stored.size}`,
        });
      }
      for (const [key, pr] of lastById) {
        const e = stored.get(key);
        if (!e) {
          violations.push({
            invariant: 'no data loss: every unique PR is stored',
            location: 'pull_requests phase',
            detail: `missing pull_request entity for ${key}`,
          });
          continue;
        }
        if (
          e.attributes.title !== pr.title ||
          e.attributes.state !== pr.state
        ) {
          violations.push({
            invariant: 'last-write-wins: stored attributes match latest copy',
            location: 'pull_requests phase',
            detail: `pull_request ${key} stored attrs do not match last input`,
          });
        }
      }
      return violations;
    };

    await runPropertySyncTest({
      connectorClass: BitbucketConnector,
      resource: 'pull_requests',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [extra, docShapeExtra],
      run: async (sample, storage) => {
        const terminated = { ...sample, next: null };
        installFetchMock((url) => {
          if (url.includes('/pullrequests')) {
            return { body: terminated };
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
      sample: z.infer<typeof BitbucketConnector.schemas.pipelines>,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const lastByUuid = lastByKey(
        sample.values,
        (p) => `${WORKSPACE}/${REPO_SLUG}:${p.uuid}`,
      );
      const stored = entityStoreFor(storage).get('pipeline') ?? new Map();
      if (stored.size !== lastByUuid.size) {
        violations.push({
          invariant: 'one pipeline entity per (workspace, repo, uuid)',
          location: 'pipelines phase',
          detail: `expected ${lastByUuid.size} entities, got ${stored.size}`,
        });
      }
      const events = eventStoreFor(storage).filter(
        (e) => e.name === 'pipeline_event',
      );
      if (events.length !== lastByUuid.size) {
        violations.push({
          invariant: 'one pipeline_event per unique pipeline uuid',
          location: 'pipelines phase',
          detail: `expected ${lastByUuid.size} events, got ${events.length}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest({
      connectorClass: BitbucketConnector,
      resource: 'pipelines',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [extra, docShapeExtra],
      run: async (sample, storage) => {
        const terminated = { ...sample, next: null };
        installFetchMock((url) => {
          if (url.includes('/pipelines')) {
            return { body: terminated };
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
    function makePR(id: number, updatedOn: string) {
      return {
        id,
        title: `PR ${id}`,
        state: 'OPEN',
        author: { nickname: 'alice' },
        source: { branch: { name: 'feat' } },
        destination: { branch: { name: 'main' } },
        created_on: updatedOn,
        updated_on: updatedOn,
        closed_on: null,
        links: {
          html: {
            href: `https://bitbucket.org/${WORKSPACE}/${REPO_SLUG}/pull-requests/${id}`,
          },
        },
      };
    }

    it('stops paginating pull_requests once a full page is entirely past `since`', async () => {
      const since = '2026-05-15T00:00:00Z';
      const page1Values = [
        makePR(10, '2026-05-20T00:00:00Z'),
        makePR(11, '2026-05-18T00:00:00Z'),
      ];
      const page2Values = [
        makePR(20, '2026-05-10T00:00:00Z'),
        makePR(21, '2026-05-08T00:00:00Z'),
      ];
      const page3Values = [makePR(30, '2026-05-01T00:00:00Z')];

      const page2Url = `https://api.bitbucket.org/2.0/repositories/${WORKSPACE}/${REPO_SLUG}/pullrequests?page=2`;
      const page3Url = `https://api.bitbucket.org/2.0/repositories/${WORKSPACE}/${REPO_SLUG}/pullrequests?page=3`;

      const spy = installFetchMock((url) => {
        if (url === page3Url) {
          return { body: { values: page3Values, next: null } };
        }
        if (url === page2Url) {
          return { body: { values: page2Values, next: page3Url } };
        }
        if (url.includes('/pullrequests')) {
          return { body: { values: page1Values, next: page2Url } };
        }
        return safeDefaultResponse(url);
      });

      const storage = new InMemoryStorage();
      await buildConnector().sync(
        {
          mode: 'full',
          since,
          resources: new Set(['pull_request']),
        },
        storage.getStorageHandle(CONNECTOR_ID),
      );

      const prCalls = spy.mock.calls
        .map(([url]) => String(url))
        .filter((url) => url.includes('/pullrequests'));
      expect(prCalls.some((u) => u === page3Url)).toBe(false);
      expect(prCalls).toHaveLength(2);
    });
  });
});
