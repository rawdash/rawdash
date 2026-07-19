import {
  type InvariantViolation,
  assertConnectorResourceShapes,
  connectorResourceShapeViolations,
  entityStoreFor,
  installFetchMock,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';
import { z } from 'zod';

import { StatusGatorConnector } from './statusgator';

const docShapeExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    StatusGatorConnector.resources,
    storage,
    connectorId,
  );

const CONNECTOR_ID = 'statusgator';

type MonitorsSample = z.infer<typeof StatusGatorConnector.schemas.monitors>;
type HistorySample = z.infer<typeof StatusGatorConnector.schemas.history>;

describe('StatusGatorConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('services: sync upholds universal invariants for any valid API payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: MonitorsSample,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const unique = new Set(sample.data.map((m) => m.id)).size;
      const written =
        entityStoreFor(storage, CONNECTOR_ID).get('statusgator_service')
          ?.size ?? 0;
      if (written !== unique) {
        violations.push({
          invariant: 'one statusgator_service entity per unique monitor id',
          location: 'services phase',
          detail: `expected ${unique} entities, got ${written}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest({
      connectorClass: StatusGatorConnector,
      resource: 'monitors',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [extra, docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock(() => sample);
        const connector = new StatusGatorConnector(
          { boardId: 'board-1', resources: ['services'] },
          { apiKey: 'api-test' as unknown as { $secret: string } },
        );
        await connector.sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('status_changes: sync upholds universal invariants for any valid API payload', async () => {
    await runPropertySyncTest({
      connectorClass: StatusGatorConnector,
      resource: 'history',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [docShapeExtra],
      run: async (sample: HistorySample, storage) => {
        installFetchMock(() => sample);
        const connector = new StatusGatorConnector(
          { boardId: 'board-1', resources: ['status_changes'] },
          { apiKey: 'api-test' as unknown as { $secret: string } },
        );
        await connector.sync(
          { mode: 'latest', since: '1970-01-01T00:00:00.000Z' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('full sync across all resources matches documented shapes', async () => {
    installFetchMock((url) => {
      if (url.includes('/monitors')) {
        return {
          success: true,
          data: [
            {
              id: 'm1',
              display_name: 'GitHub',
              filtered_status: 'up',
              service: {
                id: 's1',
                name: 'GitHub',
                slug: 'github',
                home_page_url: 'https://github.com',
                status_page_url: 'https://www.githubstatus.com',
              },
              checked_at: new Date(Date.now() - 60_000).toISOString(),
            },
          ],
          pagination: { next_page: null },
        };
      }
      if (url.includes('/history')) {
        return {
          success: true,
          data: [
            {
              monitor_id: 'm1',
              name: 'GitHub',
              status: 'up',
              started_at: new Date(Date.now() - 60_000).toISOString(),
              ended_at: null,
            },
          ],
        };
      }
      return { success: true, data: [], pagination: { next_page: null } };
    });

    const storage = new InMemoryStorage();
    const connector = new StatusGatorConnector(
      {
        boardId: 'board-1',
        resources: ['services', 'status_changes'],
      },
      { apiKey: 'api-test' as unknown as { $secret: string } },
    );
    await connector.sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    assertConnectorResourceShapes(
      StatusGatorConnector.resources,
      storage,
      CONNECTOR_ID,
    );
  });
});
