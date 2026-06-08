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

import { GitHubConnector } from './github';

const docShapeExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    GitHubConnector.resources,
    storage,
    connectorId,
  );

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
      extraInvariants: [extra, docShapeExtra],
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
      extraInvariants: [extra, docShapeExtra],
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
      const nonPrIssues = sample.filter((i) => i.pull_request === undefined);
      const lastByNumber = lastByKey(nonPrIssues, (i) => String(i.number));
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
      extraInvariants: [extra, docShapeExtra],
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
      extraInvariants: [extra, docShapeExtra],
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
      extraInvariants: [extra, docShapeExtra],
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
      extraInvariants: [extra, docShapeExtra],
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

  describe('N+1 gating and short-circuit', () => {
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
        return safeDefaultResponse(url);
      });

      const storage = new InMemoryStorage();
      await buildConnector().sync(
        { mode: 'full', resources: new Set(['pull_request']) },
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
        return safeDefaultResponse(url);
      });

      const storage = new InMemoryStorage();
      await buildConnector().sync(
        {
          mode: 'full',
          resources: new Set(['pull_request', 'pull_request_reviews']),
        },
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
        return safeDefaultResponse(url);
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

    it('preserves existing reviewed_by edges when pull_request_reviews is not in the allowlist', async () => {
      const storage = new InMemoryStorage();
      const handle = storage.getStorageHandle(CONNECTOR_ID);
      await handle.edge({
        from_type: 'pull_request',
        from_id: '1',
        kind: 'reviewed_by',
        to_type: 'user',
        to_id: 'bob',
        attributes: { state: 'APPROVED' },
        updated_at: Date.now(),
      });

      const prs = [makePR(1, '2026-05-20T00:00:00Z')];
      installFetchMock((url) => {
        if (url.match(/\/pulls(\?|$)/)) {
          return { body: prs };
        }
        return safeDefaultResponse(url);
      });

      await buildConnector().sync(
        { mode: 'full', resources: new Set(['pull_request']) },
        handle,
      );

      const edges = await handle.traverse({ kind: 'reviewed_by' });
      expect(edges).toHaveLength(1);
      expect(edges[0]?.to_id).toBe('bob');
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
        return safeDefaultResponse(url);
      });

      const storage = new InMemoryStorage();
      await buildConnector().sync(
        { mode: 'full', resources: new Set(['deployment']) },
        storage.getStorageHandle(CONNECTOR_ID),
      );

      const statusCalls = spy.mock.calls.filter(([url]) =>
        String(url).includes('/statuses'),
      );
      expect(statusCalls).toHaveLength(0);
    });

    it('preserves prior latest_status when deployment_statuses is not in the allowlist', async () => {
      const storage = new InMemoryStorage();
      const handle = storage.getStorageHandle(CONNECTOR_ID);
      await handle.entity({
        type: 'deployment',
        id: '1',
        attributes: {
          environment: 'production',
          ref: 'main',
          sha: 'oldsha',
          creator: 'alice',
          created_at: Date.parse('2026-05-19T00:00:00Z'),
          latest_status: 'success',
        },
        updated_at: Date.parse('2026-05-19T00:00:00Z'),
      });

      const deployments = [makeDeployment(1, '2026-05-20T00:00:00Z')];
      installFetchMock((url) => {
        if (url.match(/\/deployments(\?|$)/)) {
          return { body: deployments };
        }
        return safeDefaultResponse(url);
      });

      await buildConnector().sync(
        { mode: 'full', resources: new Set(['deployment']) },
        handle,
      );

      const stored = await handle.getEntity('deployment', '1');
      expect(stored?.attributes['latest_status']).toBe('success');
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
        return safeDefaultResponse(url);
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
      expect(reviewCalls.some((u) => u.includes('/pulls/1/reviews'))).toBe(
        true,
      );
      expect(reviewCalls.some((u) => u.includes('/pulls/2/reviews'))).toBe(
        true,
      );
      expect(reviewCalls.some((u) => u.includes('/pulls/3/reviews'))).toBe(
        false,
      );
      expect(reviewCalls.some((u) => u.includes('/pulls/4/reviews'))).toBe(
        false,
      );
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
        return safeDefaultResponse(url);
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

  describe('widget-required window bounding', () => {
    const day = 86_400_000;

    function makeRun(id: number, createdAtMs: number) {
      const iso = new Date(createdAtMs).toISOString();
      return {
        id,
        name: `run ${id}`,
        conclusion: 'success',
        status: 'completed',
        head_branch: 'main',
        actor: { login: 'alice' },
        created_at: iso,
        updated_at: iso,
        run_attempt: 1,
      };
    }

    it('stops paginating workflow_runs once a page predates the required window', async () => {
      const now = Date.now();
      const linkHeader = (next: string) => `<${next}>; rel="next"`;
      const page2Url =
        'https://api.github.com/repos/rawdash/rawdash/actions/runs?page=2';
      const page3Url =
        'https://api.github.com/repos/rawdash/rawdash/actions/runs?page=3';

      const page1 = {
        workflow_runs: [makeRun(10, now - 1 * day), makeRun(11, now - 2 * day)],
      };
      const page2 = {
        workflow_runs: [
          makeRun(20, now - 6 * day),
          makeRun(21, now - 20 * day),
        ],
      };
      const page3 = { workflow_runs: [makeRun(30, now - 40 * day)] };

      const spy = installFetchMock((url) => {
        if (url === page3Url) {
          return { body: page3 };
        }
        if (url === page2Url) {
          return { body: page2, headers: { link: linkHeader(page3Url) } };
        }
        if (url.includes('/actions/runs')) {
          return { body: page1, headers: { link: linkHeader(page2Url) } };
        }
        return safeDefaultResponse(url);
      });

      const storage = new InMemoryStorage();
      await buildConnector().sync(
        {
          mode: 'full',
          resources: new Set(['workflow_run']),
          requiredWindowMs: { workflow_run: 7 * day },
        },
        storage.getStorageHandle(CONNECTOR_ID),
      );

      const runCalls = spy.mock.calls
        .map(([url]) => String(url))
        .filter((url) => url.includes('/actions/runs'));
      expect(runCalls).toHaveLength(2);
      expect(runCalls.some((u) => u === page3Url)).toBe(false);
    });

    it('fetches unbounded workflow_runs history when no window is supplied', async () => {
      const now = Date.now();
      const linkHeader = (next: string) => `<${next}>; rel="next"`;
      const page2Url =
        'https://api.github.com/repos/rawdash/rawdash/actions/runs?page=2';
      const page3Url =
        'https://api.github.com/repos/rawdash/rawdash/actions/runs?page=3';

      const page1 = { workflow_runs: [makeRun(10, now - 1 * day)] };
      const page2 = { workflow_runs: [makeRun(20, now - 200 * day)] };
      const page3 = { workflow_runs: [makeRun(30, now - 400 * day)] };

      const spy = installFetchMock((url) => {
        if (url === page3Url) {
          return { body: page3 };
        }
        if (url === page2Url) {
          return { body: page2, headers: { link: linkHeader(page3Url) } };
        }
        if (url.includes('/actions/runs')) {
          return { body: page1, headers: { link: linkHeader(page2Url) } };
        }
        return safeDefaultResponse(url);
      });

      const storage = new InMemoryStorage();
      await buildConnector().sync(
        { mode: 'full', resources: new Set(['workflow_run']) },
        storage.getStorageHandle(CONNECTOR_ID),
      );

      const runCalls = spy.mock.calls
        .map(([url]) => String(url))
        .filter((url) => url.includes('/actions/runs'));
      expect(runCalls).toHaveLength(3);
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
      extraInvariants: [extra, docShapeExtra],
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
