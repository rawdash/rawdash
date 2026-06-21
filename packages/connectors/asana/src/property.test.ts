import {
  type InvariantViolation,
  connectorResourceShapeViolations,
  entityStoreFor,
  installFetchMock,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import type { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';
import { z } from 'zod';

import { AsanaConnector } from './asana';

const docShapeExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    AsanaConnector.resources,
    storage,
    connectorId,
  );

const CONNECTOR_ID = 'asana';

const CREDS = {
  apiToken: 'asana_token' as unknown as { $secret: string },
};

type ProjectsSample = z.infer<typeof AsanaConnector.schemas.projects>;
type UsersSample = z.infer<typeof AsanaConnector.schemas.users>;
type TasksSample = z.infer<typeof AsanaConnector.schemas.tasks>;

function makeConnector(
  resources: string[],
  extra: Record<string, unknown> = {},
): AsanaConnector {
  return new AsanaConnector(
    { workspaceGid: '900', resources: resources as never, ...extra } as never,
    CREDS,
  );
}

describe('AsanaConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('projects: sync upholds universal invariants for any valid API payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: ProjectsSample,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const unique = new Set(sample.data.map((p) => p.gid)).size;
      const written =
        entityStoreFor(storage, CONNECTOR_ID).get('asana_project')?.size ?? 0;
      if (written !== unique) {
        violations.push({
          invariant: 'one asana_project entity per unique gid',
          location: 'projects phase',
          detail: `expected ${unique} entities, got ${written}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest({
      connectorClass: AsanaConnector,
      resource: 'projects',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [extra, docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock(() => ({ ...sample, next_page: null }));
        await makeConnector(['projects']).sync(
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
      const unique = new Set(sample.data.map((u) => u.gid)).size;
      const written =
        entityStoreFor(storage, CONNECTOR_ID).get('asana_user')?.size ?? 0;
      if (written !== unique) {
        violations.push({
          invariant: 'one asana_user entity per unique gid',
          location: 'users phase',
          detail: `expected ${unique} entities, got ${written}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest({
      connectorClass: AsanaConnector,
      resource: 'users',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [extra, docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock(() => ({ ...sample, next_page: null }));
        await makeConnector(['users']).sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('tasks: sync upholds universal invariants for any valid API payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: TasksSample,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const unique = new Set(sample.data.map((t) => t.gid)).size;
      const written =
        entityStoreFor(storage, CONNECTOR_ID).get('asana_task')?.size ?? 0;
      if (written !== unique) {
        violations.push({
          invariant: 'one asana_task entity per unique gid',
          location: 'tasks phase',
          detail: `expected ${unique} entities, got ${written}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest({
      connectorClass: AsanaConnector,
      resource: 'tasks',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [extra, docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock((url) => {
          if (/\/tasks\/[^/]+\/stories/.test(url)) {
            return { data: [], next_page: null };
          }
          if (url.includes('/tasks')) {
            return { ...sample, next_page: null };
          }
          return {
            data: [{ gid: '1', name: 'Project' }],
            next_page: null,
          };
        });
        await makeConnector(['tasks'], { projectGids: ['1'] }).sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });
});
