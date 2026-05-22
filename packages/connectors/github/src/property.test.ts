import {
  type InvariantViolation,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import type { InMemoryStorage } from '@rawdash/core';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';
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

type StoredEntity = {
  type: string;
  id: string;
  attributes: Record<string, unknown>;
};

function entityStoreFor(
  storage: InMemoryStorage,
): Map<string, Map<string, StoredEntity>> {
  return (
    (
      storage as unknown as {
        entityStore: Map<string, Map<string, Map<string, StoredEntity>>>;
      }
    ).entityStore.get(CONNECTOR_ID) ?? new Map()
  );
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
      sample: z.infer<typeof workflowRunsResponseSchema>,
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
      sample: z.infer<typeof issuesSchema>,
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
      sample: z.infer<typeof releasesSchema>,
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
