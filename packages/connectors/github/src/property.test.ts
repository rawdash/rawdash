import {
  type InvariantViolation,
  type MockResponseInit,
  installFetchMockAdvanced,
  runPropertySyncTest,
  entityStoreFor as sharedEntityStoreFor,
  eventStoreFor as sharedEventStoreFor,
} from '@rawdash/connector-test-utils';
import type { InMemoryStorage } from '@rawdash/core';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import { z } from 'zod';

import { GitHubConnector } from './github';

const CONNECTOR_ID = 'github-actions';

type StoredEntity = {
  type: string;
  id: string;
  attributes: Record<string, unknown>;
};

const installFetchMock = installFetchMockAdvanced;

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

function buildConnector(): GitHubConnector {
  return new GitHubConnector(
    { owner: 'rawdash', repo: 'rawdash' },
    { token: undefined },
  );
}

function safeDefaultResponse(url: string): MockResponseInit {
  if (url.includes('/actions/runs')) {
    return { body: { workflow_runs: [] } };
  }
  if (url.includes('/stats/contributors')) {
    return { body: [] };
  }
  if (
    url.includes('/pulls') ||
    url.includes('/issues') ||
    url.includes('/deployments') ||
    url.includes('/releases') ||
    url.includes('/reviews') ||
    url.includes('/statuses')
  ) {
    return { body: [] };
  }
  if (url.match(/\/repos\/[^/]+\/[^/]+$/)) {
    return {
      body: { stargazers_count: 0, forks_count: 0, subscribers_count: 0 },
    };
  }
  return { body: [] };
}

const S = GitHubConnector.schemas;

describe('GitHubConnector property tests', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('workflow_runs: sync upholds universal invariants for any valid API payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: z.infer<typeof S.workflow_runs>,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const lastById = lastByKey(sample.workflow_runs, (r) => String(r.id));
      const events = eventStoreFor(storage).filter(
        (e) => e.name === 'workflow_run',
      ) as Array<{ name: string; attributes: { id: number } }>;
      if (events.length !== lastById.size) {
        violations.push({
          invariant: 'one workflow_run event per unique run id (no dupes)',
          location: 'workflow_runs phase',
          detail: `expected ${lastById.size} events, got ${events.length}`,
        });
      }
      const writtenIds = new Set(events.map((e) => String(e.attributes.id)));
      for (const id of lastById.keys()) {
        if (!writtenIds.has(id)) {
          violations.push({
            invariant: 'no data loss: every input id is represented',
            location: 'workflow_runs phase',
            detail: `missing event for run id ${id}`,
          });
        }
      }
      return violations;
    };

    await runPropertySyncTest({
      connectorClass: GitHubConnector,
      resource: 'workflow_runs',
      connectorId: CONNECTOR_ID,
      runs: 100,
      extraInvariants: [extra],
      run: async (sample, storage) => {
        installFetchMock((url) => {
          if (url.includes('/actions/runs')) {
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

  it('pull_requests: sync upholds universal invariants for any valid API payload', async () => {
    const combinedSchema = z.object({
      prs: S.pull_requests,
      reviewsPerPR: S.pull_request_reviews,
    });

    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: z.infer<typeof combinedSchema>,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const lastByNumber = lastByKey(sample.prs, (p) => String(p.number));
      const entityByType = entityStoreFor(storage);
      const stored = entityByType.get('pull_request') ?? new Map();
      if (stored.size !== lastByNumber.size) {
        violations.push({
          invariant: 'one pull_request entity per unique PR number',
          location: 'pull_requests phase',
          detail: `expected ${lastByNumber.size} entities, got ${stored.size}`,
        });
      }
      for (const [id, pr] of lastByNumber) {
        const e = stored.get(id);
        if (!e) {
          violations.push({
            invariant: 'no data loss: every unique PR is stored',
            location: 'pull_requests phase',
            detail: `missing pull_request entity for #${id}`,
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
            detail: `pull_request #${id} stored attrs do not match last input`,
          });
        }
      }
      return violations;
    };

    await runPropertySyncTest({
      schema: combinedSchema,
      connectorId: CONNECTOR_ID,
      runs: 100,
      extraInvariants: [extra],
      run: async (sample, storage) => {
        installFetchMock((url) => {
          if (url.includes('/reviews')) {
            return { body: sample.reviewsPerPR };
          }
          if (url.match(/\/pulls(\?|$)/)) {
            return { body: sample.prs };
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
      sample: z.infer<typeof S.issues>,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const lastByNumber = lastByKey(sample, (i) => String(i.number));
      const stored = entityStoreFor(storage).get('issue') ?? new Map();
      if (stored.size !== lastByNumber.size) {
        violations.push({
          invariant: 'one issue entity per unique issue number',
          location: 'issues phase',
          detail: `expected ${lastByNumber.size} entities, got ${stored.size}`,
        });
      }
      for (const [id, issue] of lastByNumber) {
        const e = stored.get(id);
        if (!e) {
          violations.push({
            invariant: 'no data loss: every unique issue is stored',
            location: 'issues phase',
            detail: `missing issue entity for #${id}`,
          });
          continue;
        }
        if (
          e.attributes.title !== issue.title ||
          e.attributes.state !== issue.state
        ) {
          violations.push({
            invariant: 'last-write-wins: stored attributes match latest copy',
            location: 'issues phase',
            detail: `issue #${id} stored attrs do not match last input`,
          });
        }
      }
      return violations;
    };

    await runPropertySyncTest({
      connectorClass: GitHubConnector,
      resource: 'issues',
      connectorId: CONNECTOR_ID,
      runs: 100,
      extraInvariants: [extra],
      run: async (sample, storage) => {
        installFetchMock((url) => {
          if (url.includes('/issues')) {
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

  it('deployments: sync upholds universal invariants for any valid API payload', async () => {
    const combinedSchema = z.object({
      deployments: S.deployments,
      statuses: S.deployment_statuses,
    });

    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: z.infer<typeof combinedSchema>,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const lastById = lastByKey(sample.deployments, (d) => String(d.id));
      const stored = entityStoreFor(storage).get('deployment') ?? new Map();
      if (stored.size !== lastById.size) {
        violations.push({
          invariant: 'one deployment entity per unique deployment id',
          location: 'deployments phase',
          detail: `expected ${lastById.size} entities, got ${stored.size}`,
        });
      }
      for (const [id, dep] of lastById) {
        const e = stored.get(id);
        if (!e) {
          violations.push({
            invariant: 'no data loss: every unique deployment is stored',
            location: 'deployments phase',
            detail: `missing deployment entity for ${id}`,
          });
          continue;
        }
        if (
          e.attributes.environment !== dep.environment ||
          e.attributes.sha !== dep.sha
        ) {
          violations.push({
            invariant: 'last-write-wins: stored attributes match latest copy',
            location: 'deployments phase',
            detail: `deployment ${id} stored attrs do not match last input`,
          });
        }
      }
      return violations;
    };

    await runPropertySyncTest({
      schema: combinedSchema,
      connectorId: CONNECTOR_ID,
      runs: 100,
      extraInvariants: [extra],
      run: async (sample, storage) => {
        installFetchMock((url) => {
          if (url.includes('/statuses')) {
            return { body: sample.statuses };
          }
          if (url.includes('/deployments')) {
            return { body: sample.deployments };
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
      sample: z.infer<typeof S.releases>,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const lastById = lastByKey(sample, (r) => String(r.id));
      const stored = entityStoreFor(storage).get('release') ?? new Map();
      if (stored.size !== lastById.size) {
        violations.push({
          invariant: 'one release entity per unique release id',
          location: 'releases phase',
          detail: `expected ${lastById.size} entities, got ${stored.size}`,
        });
      }
      for (const [id, rel] of lastById) {
        const e = stored.get(id);
        if (!e) {
          violations.push({
            invariant: 'no data loss: every unique release is stored',
            location: 'releases phase',
            detail: `missing release entity for ${id}`,
          });
          continue;
        }
        if (
          e.attributes.tag_name !== rel.tag_name ||
          e.attributes.draft !== rel.draft
        ) {
          violations.push({
            invariant: 'last-write-wins: stored attributes match latest copy',
            location: 'releases phase',
            detail: `release ${id} stored attrs do not match last input`,
          });
        }
      }
      return violations;
    };

    await runPropertySyncTest({
      connectorClass: GitHubConnector,
      resource: 'releases',
      connectorId: CONNECTOR_ID,
      runs: 100,
      extraInvariants: [extra],
      run: async (sample, storage) => {
        installFetchMock((url) => {
          if (url.includes('/releases')) {
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

  it('contributors: sync upholds universal invariants for any valid API payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: z.infer<typeof S.contributors>,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const lastByLogin = lastByKey(sample, (c) => c.author.login);
      const stored = entityStoreFor(storage).get('contributor') ?? new Map();
      if (stored.size !== lastByLogin.size) {
        violations.push({
          invariant: 'one contributor entity per unique author login',
          location: 'contributors phase',
          detail: `expected ${lastByLogin.size} entities, got ${stored.size}`,
        });
      }
      for (const [login, c] of lastByLogin) {
        const e = stored.get(login);
        if (!e) {
          violations.push({
            invariant: 'no data loss: every unique contributor is stored',
            location: 'contributors phase',
            detail: `missing contributor entity for ${login}`,
          });
          continue;
        }
        if (e.attributes.commits !== c.total) {
          violations.push({
            invariant: 'last-write-wins: stored attributes match latest copy',
            location: 'contributors phase',
            detail: `contributor ${login} stored commits do not match last input`,
          });
        }
      }
      return violations;
    };

    await runPropertySyncTest({
      connectorClass: GitHubConnector,
      resource: 'contributors',
      connectorId: CONNECTOR_ID,
      runs: 100,
      extraInvariants: [extra],
      run: async (sample, storage) => {
        installFetchMock((url) => {
          if (url.includes('/stats/contributors')) {
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

  it('repo_stats: sync upholds universal invariants for any valid API payload', async () => {
    const extra = (storage: InMemoryStorage): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const entityByType = entityStoreFor(storage);
      const written = entityByType.get('repo')?.size ?? 0;
      if (written !== 1) {
        violations.push({
          invariant: 'exactly one repo entity is written',
          location: 'repo_stats phase',
          detail: `expected 1 entity, got ${written}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest({
      connectorClass: GitHubConnector,
      resource: 'repo',
      connectorId: CONNECTOR_ID,
      runs: 100,
      extraInvariants: [extra],
      run: async (sample, storage) => {
        installFetchMock((url) => {
          if (url.match(/\/repos\/[^/]+\/[^/]+$/)) {
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
});
