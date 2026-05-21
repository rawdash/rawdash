import {
  type InvariantViolation,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import type { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';
import { z } from 'zod';

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

function eventStoreFor(storage: InMemoryStorage): Array<{ name: string }> {
  return (
    ((
      storage as unknown as { eventStore: Map<string, unknown[]> }
    ).eventStore.get(CONNECTOR_ID) as Array<{ name: string }> | undefined) ?? []
  );
}

function entityStoreFor(
  storage: InMemoryStorage,
): Map<string, Map<string, { type: string; id: string }>> {
  return (
    (
      storage as unknown as {
        entityStore: Map<
          string,
          Map<string, Map<string, { type: string; id: string }>>
        >;
      }
    ).entityStore.get(CONNECTOR_ID) ?? new Map()
  );
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

const workflowRunsResponseSchema = z.object({
  workflow_runs: z.array(
    z.object({
      id: z.number().int(),
      name: z.string(),
      conclusion: z.string().nullable(),
      status: z.string(),
      head_branch: z.string().nullable(),
      actor: z.object({ login: z.string().min(1) }).nullable(),
      created_at: z.iso.datetime(),
      updated_at: z.iso.datetime(),
      run_attempt: z.number().int(),
    }),
  ),
});

const pullRequestsSchema = z.array(
  z.object({
    number: z.number().int(),
    title: z.string(),
    state: z.string(),
    draft: z.boolean(),
    user: z.object({ login: z.string().min(1) }),
    created_at: z.iso.datetime(),
    updated_at: z.iso.datetime(),
  }),
);

const reviewsSchema = z.array(
  z.object({
    user: z.object({ login: z.string().min(1) }).nullable(),
    state: z.string(),
    submitted_at: z.iso.datetime(),
  }),
);

const issuesSchema = z.array(
  z.object({
    number: z.number().int(),
    title: z.string(),
    state: z.string(),
    labels: z.array(z.object({ name: z.string() })),
    assignees: z.array(z.object({ login: z.string().min(1) })),
    user: z.object({ login: z.string().min(1) }),
    created_at: z.iso.datetime(),
    updated_at: z.iso.datetime(),
    closed_at: z.iso.datetime().nullable(),
  }),
);

const deploymentsSchema = z.array(
  z.object({
    id: z.number().int(),
    environment: z.string(),
    ref: z.string(),
    sha: z.string(),
    creator: z.object({ login: z.string().min(1) }).nullable(),
    created_at: z.iso.datetime(),
  }),
);

const deploymentStatusesSchema = z.array(
  z.object({
    state: z.string(),
    updated_at: z.iso.datetime(),
  }),
);

const releasesSchema = z.array(
  z.object({
    id: z.number().int(),
    tag_name: z.string(),
    name: z.string().nullable(),
    draft: z.boolean(),
    prerelease: z.boolean(),
    created_at: z.iso.datetime(),
    published_at: z.iso.datetime().nullable(),
    author: z.object({ login: z.string().min(1) }),
  }),
);

const contributorsSchema = z.array(
  z.object({
    total: z.number().int(),
    weeks: z.array(
      z.object({
        w: z.number().int(),
        a: z.number().int(),
        d: z.number().int(),
        c: z.number().int(),
      }),
    ),
    author: z.object({ login: z.string().min(1) }),
  }),
);

const repoStatsSchema = z.object({
  stargazers_count: z.number().int(),
  forks_count: z.number().int(),
  subscribers_count: z.number().int(),
});

describe('GitHubConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('workflow_runs: sync upholds universal invariants for any valid API payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: z.infer<typeof workflowRunsResponseSchema>,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const expected = sample.workflow_runs.length;
      const written = eventStoreFor(storage).filter(
        (e) => e.name === 'workflow_run',
      ).length;
      if (written !== expected) {
        violations.push({
          invariant: 'one workflow_run event per workflow_runs[] entry',
          location: 'workflow_runs phase',
          detail: `expected ${expected} events, got ${written}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest({
      schema: workflowRunsResponseSchema,
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
      prs: pullRequestsSchema,
      reviewsPerPR: reviewsSchema,
    });

    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: z.infer<typeof combinedSchema>,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const unique = new Set(sample.prs.map((p) => p.number)).size;
      const entityByType = entityStoreFor(storage);
      const written = entityByType.get('pull_request')?.size ?? 0;
      if (written !== unique) {
        violations.push({
          invariant: 'one pull_request entity per unique PR number',
          location: 'pull_requests phase',
          detail: `expected ${unique} entities, got ${written}`,
        });
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
      sample: z.infer<typeof issuesSchema>,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const entityByType = entityStoreFor(storage);
      const written = entityByType.get('issue')?.size ?? 0;
      const unique = new Set(sample.map((i) => i.number)).size;
      if (written !== unique) {
        violations.push({
          invariant: 'one issue entity per unique issue number',
          location: 'issues phase',
          detail: `expected ${unique} entities, got ${written}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest({
      schema: issuesSchema,
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
      deployments: deploymentsSchema,
      statuses: deploymentStatusesSchema,
    });

    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: z.infer<typeof combinedSchema>,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const entityByType = entityStoreFor(storage);
      const written = entityByType.get('deployment')?.size ?? 0;
      const unique = new Set(sample.deployments.map((d) => d.id)).size;
      if (written !== unique) {
        violations.push({
          invariant: 'one deployment entity per unique deployment id',
          location: 'deployments phase',
          detail: `expected ${unique} entities, got ${written}`,
        });
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
      sample: z.infer<typeof releasesSchema>,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const entityByType = entityStoreFor(storage);
      const written = entityByType.get('release')?.size ?? 0;
      const unique = new Set(sample.map((r) => r.id)).size;
      if (written !== unique) {
        violations.push({
          invariant: 'one release entity per unique release id',
          location: 'releases phase',
          detail: `expected ${unique} entities, got ${written}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest({
      schema: releasesSchema,
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
      sample: z.infer<typeof contributorsSchema>,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const entityByType = entityStoreFor(storage);
      const written = entityByType.get('contributor')?.size ?? 0;
      const unique = new Set(sample.map((c) => c.author.login)).size;
      if (written !== unique) {
        violations.push({
          invariant: 'one contributor entity per unique author login',
          location: 'contributors phase',
          detail: `expected ${unique} entities, got ${written}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest({
      schema: contributorsSchema,
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
      schema: repoStatsSchema,
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
