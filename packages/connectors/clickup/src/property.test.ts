import {
  type InvariantViolation,
  connectorResourceShapeViolations,
  entityStoreFor,
  installFetchMock,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import type { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';
import type { z } from 'zod';

import { ClickUpConnector } from './clickup';

const CONNECTOR_ID = 'clickup';
const TOKEN = 'pk_test' as unknown as { $secret: string };

type SpacesSample = z.infer<typeof ClickUpConnector.schemas.spaces>;
type FoldersSample = z.infer<typeof ClickUpConnector.schemas.folders>;
type ListsSample = z.infer<typeof ClickUpConnector.schemas.lists>;
type TasksSample = z.infer<typeof ClickUpConnector.schemas.tasks>;

const docShapeExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    ClickUpConnector.resources,
    storage,
    connectorId,
  );

function uniqueEntityInvariant<T>(
  entityType: string,
  phase: string,
  ids: (sample: T) => string[],
): (
  storage: InMemoryStorage,
  connectorId: string,
  sample: T,
) => InvariantViolation[] {
  return (storage, _connectorId, sample) => {
    const violations: InvariantViolation[] = [];
    const unique = new Set(ids(sample)).size;
    const written =
      entityStoreFor(storage, CONNECTOR_ID).get(entityType)?.size ?? 0;
    if (written !== unique) {
      violations.push({
        invariant: `one ${entityType} entity per unique id`,
        location: `${phase} phase`,
        detail: `expected ${unique} entities, got ${written}`,
      });
    }
    return violations;
  };
}

async function syncWith(
  resource: string,
  storage: InMemoryStorage,
): Promise<void> {
  const c = new ClickUpConnector(
    { teamId: '900', resources: [resource] as never },
    { apiToken: TOKEN },
  );
  await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
}

describe('ClickUpConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('spaces: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<SpacesSample>({
      connectorClass: ClickUpConnector,
      resource: 'spaces',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [
        uniqueEntityInvariant<SpacesSample>('clickup_space', 'spaces', (s) =>
          (s.spaces ?? []).map((x) => x.id),
        ),
        docShapeExtra,
      ],
      run: async (sample, storage) => {
        installFetchMock(() => sample);
        await syncWith('spaces', storage);
      },
    });
  });

  it('folders: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<FoldersSample>({
      connectorClass: ClickUpConnector,
      resource: 'folders',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [
        uniqueEntityInvariant<FoldersSample>('clickup_folder', 'folders', (s) =>
          (s.folders ?? []).map((x) => x.id),
        ),
        docShapeExtra,
      ],
      run: async (sample, storage) => {
        installFetchMock((url) =>
          url.includes('/space?') || url.includes('/space&')
            ? { spaces: [{ id: 'space1', name: 'Space One' }] }
            : url.includes('/team/900/space')
              ? { spaces: [{ id: 'space1', name: 'Space One' }] }
              : sample,
        );
        await syncWith('folders', storage);
      },
    });
  });

  it('lists: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<ListsSample>({
      connectorClass: ClickUpConnector,
      resource: 'lists',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [
        uniqueEntityInvariant<ListsSample>('clickup_list', 'lists', (s) =>
          (s.lists ?? []).map((x) => x.id),
        ),
        docShapeExtra,
      ],
      run: async (sample, storage) => {
        installFetchMock((url) => {
          if (url.includes('/team/900/space')) {
            return { spaces: [{ id: 'space1', name: 'Space One' }] };
          }
          if (url.includes('/space/space1/folder')) {
            return { folders: [{ id: 'folder1', name: 'Folder One' }] };
          }
          return sample;
        });
        await syncWith('lists', storage);
      },
    });
  });

  it('tasks: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<TasksSample>({
      connectorClass: ClickUpConnector,
      resource: 'tasks',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [
        uniqueEntityInvariant<TasksSample>('clickup_task', 'tasks', (s) =>
          (s.tasks ?? []).map((x) => x.id),
        ),
        docShapeExtra,
      ],
      run: async (sample, storage) => {
        installFetchMock(() => ({
          tasks: sample.tasks ?? [],
          last_page: true,
        }));
        await syncWith('tasks', storage);
      },
    });
  });

  it('task_events: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<TasksSample>({
      connectorClass: ClickUpConnector,
      resource: 'task_events',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock(() => ({
          tasks: sample.tasks ?? [],
          last_page: true,
        }));
        await syncWith('task_events', storage);
      },
    });
  });
});
