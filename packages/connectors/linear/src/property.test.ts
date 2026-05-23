import {
  type InvariantViolation,
  entityStoreFor,
  mockJsonResponse,
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
    return Promise.resolve(mockJsonResponse({ data }));
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

function makeConnector(): LinearConnector {
  return new LinearConnector(
    {},
    { apiKey: 'lin_api_test' as unknown as { $secret: string } },
  );
}

type TeamsSample = z.infer<typeof LinearConnector.schemas.teams>;
type UsersSample = z.infer<typeof LinearConnector.schemas.users>;
type CyclesSample = z.infer<typeof LinearConnector.schemas.cycles>;
type IssuesSample = z.infer<typeof LinearConnector.schemas.issues>;

describe('LinearConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('teams: sync upholds universal invariants for any valid API payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: TeamsSample,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const unique = new Set(sample.map((t) => t.id)).size;
      const written =
        entityStoreFor(storage, CONNECTOR_ID).get('linear_team')?.size ?? 0;
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
      connectorClass: LinearConnector,
      resource: 'teams',
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
      sample: UsersSample,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const unique = new Set(sample.map((u) => u.id)).size;
      const written =
        entityStoreFor(storage, CONNECTOR_ID).get('linear_user')?.size ?? 0;
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
      connectorClass: LinearConnector,
      resource: 'users',
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
      sample: CyclesSample,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const unique = new Set(sample.map((c) => c.id)).size;
      const written =
        entityStoreFor(storage, CONNECTOR_ID).get('linear_cycle')?.size ?? 0;
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
      connectorClass: LinearConnector,
      resource: 'cycles',
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
      sample: IssuesSample,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const unique = new Set(sample.map((i) => i.id)).size;
      const written =
        entityStoreFor(storage, CONNECTOR_ID).get('linear_issue')?.size ?? 0;
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
      connectorClass: LinearConnector,
      resource: 'issues',
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
