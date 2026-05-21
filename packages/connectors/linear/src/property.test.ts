import {
  type InvariantViolation,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import type { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';
import { z } from 'zod';

import { LinearConnector } from './linear';

const CONNECTOR_ID = 'linear';

interface GraphQLCall {
  query: string;
  variables: Record<string, unknown>;
}

function emptyConn() {
  return { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } };
}

function operationName(query: string): string {
  return query.match(/query\s+(\w+)/)?.[1] ?? '';
}

function installGraphqlMock(
  responseFor: (op: string) => Record<string, unknown>,
): ReturnType<typeof vi.fn> {
  const spy = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
    const parsed = JSON.parse(init.body as string) as GraphQLCall;
    const data = responseFor(operationName(parsed.query));
    return Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      text: () => Promise.resolve(JSON.stringify({ data })),
    } as Response);
  });
  vi.stubGlobal('fetch', spy);
  return spy;
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

function makeConnector(): LinearConnector {
  return new LinearConnector(
    {},
    { apiKey: 'lin_api_test' as unknown as { $secret: string } },
  );
}

const idString = z.string().min(1);

const teamsSchema = z.array(
  z.object({
    id: idString,
    name: z.string(),
    key: z.string(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  }),
);

const usersSchema = z.array(
  z.object({
    id: idString,
    name: z.string(),
    email: z.string().nullable(),
    displayName: z.string(),
    active: z.boolean(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  }),
);

const cyclesSchema = z.array(
  z.object({
    id: idString,
    number: z.number().int(),
    name: z.string().nullable(),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    completedAt: z.iso.datetime().nullable(),
    progress: z.number().nullable(),
    scopeHistory: z.array(z.number()).nullable(),
    completedScopeHistory: z.array(z.number()).nullable(),
    team: z.object({ id: idString }).nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  }),
);

const issuesSchema = z.array(
  z.object({
    id: idString,
    identifier: z.string(),
    title: z.string(),
    priority: z.number().int(),
    estimate: z.number().nullable(),
    state: z
      .object({ id: idString, name: z.string(), type: z.string() })
      .nullable(),
    assignee: z.object({ id: idString }).nullable(),
    team: z.object({ id: idString }).nullable(),
    project: z.object({ id: idString }).nullable(),
    cycle: z.object({ id: idString }).nullable(),
    labels: z.object({
      nodes: z.array(z.object({ id: idString, name: z.string() })),
    }),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    completedAt: z.iso.datetime().nullable(),
    canceledAt: z.iso.datetime().nullable(),
    startedAt: z.iso.datetime().nullable(),
    history: z.object({
      nodes: z.array(
        z.object({
          id: idString,
          createdAt: z.iso.datetime(),
          actor: z.object({ id: idString }).nullable(),
          fromState: z.object({ id: idString, name: z.string() }).nullable(),
          toState: z.object({ id: idString, name: z.string() }).nullable(),
          fromAssignee: z.object({ id: idString }).nullable(),
          toAssignee: z.object({ id: idString }).nullable(),
        }),
      ),
      pageInfo: z.object({
        hasNextPage: z.boolean(),
        endCursor: z.string().nullable(),
      }),
    }),
  }),
);

describe('LinearConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('teams: sync upholds universal invariants for any valid API payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: z.infer<typeof teamsSchema>,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const unique = new Set(sample.map((t) => t.id)).size;
      const written = entityStoreFor(storage).get('linear_team')?.size ?? 0;
      if (written !== unique) {
        violations.push({
          invariant: 'one linear_team entity per unique team id',
          location: 'teams phase',
          detail: `expected ${unique} entities, got ${written}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest({
      schema: teamsSchema,
      connectorId: CONNECTOR_ID,
      runs: 100,
      extraInvariants: [extra],
      run: async (sample, storage) => {
        installGraphqlMock((op) => {
          if (op === 'Teams') {
            return {
              teams: {
                nodes: sample,
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            };
          }
          return {
            teams: emptyConn(),
            users: emptyConn(),
            cycles: emptyConn(),
            issues: emptyConn(),
          };
        });
        await makeConnector().sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('users: sync upholds universal invariants for any valid API payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: z.infer<typeof usersSchema>,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const unique = new Set(sample.map((u) => u.id)).size;
      const written = entityStoreFor(storage).get('linear_user')?.size ?? 0;
      if (written !== unique) {
        violations.push({
          invariant: 'one linear_user entity per unique user id',
          location: 'users phase',
          detail: `expected ${unique} entities, got ${written}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest({
      schema: usersSchema,
      connectorId: CONNECTOR_ID,
      runs: 100,
      extraInvariants: [extra],
      run: async (sample, storage) => {
        installGraphqlMock((op) => {
          if (op === 'Users') {
            return {
              users: {
                nodes: sample,
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            };
          }
          return {
            teams: emptyConn(),
            users: emptyConn(),
            cycles: emptyConn(),
            issues: emptyConn(),
          };
        });
        await makeConnector().sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('cycles: sync upholds universal invariants for any valid API payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: z.infer<typeof cyclesSchema>,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const unique = new Set(sample.map((c) => c.id)).size;
      const written = entityStoreFor(storage).get('linear_cycle')?.size ?? 0;
      if (written !== unique) {
        violations.push({
          invariant: 'one linear_cycle entity per unique cycle id',
          location: 'cycles phase',
          detail: `expected ${unique} entities, got ${written}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest({
      schema: cyclesSchema,
      connectorId: CONNECTOR_ID,
      runs: 100,
      extraInvariants: [extra],
      run: async (sample, storage) => {
        installGraphqlMock((op) => {
          if (op === 'Cycles') {
            return {
              cycles: {
                nodes: sample,
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            };
          }
          return {
            teams: emptyConn(),
            users: emptyConn(),
            cycles: emptyConn(),
            issues: emptyConn(),
          };
        });
        await makeConnector().sync(
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
      const unique = new Set(sample.map((i) => i.id)).size;
      const written = entityStoreFor(storage).get('linear_issue')?.size ?? 0;
      if (written !== unique) {
        violations.push({
          invariant: 'one linear_issue entity per unique issue id',
          location: 'issues phase',
          detail: `expected ${unique} entities, got ${written}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest({
      schema: issuesSchema,
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [extra],
      run: async (sample, storage) => {
        installGraphqlMock((op) => {
          if (op === 'Issues') {
            return {
              issues: {
                nodes: sample,
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            };
          }
          return {
            teams: emptyConn(),
            users: emptyConn(),
            cycles: emptyConn(),
            issues: emptyConn(),
          };
        });
        await makeConnector().sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });
});
