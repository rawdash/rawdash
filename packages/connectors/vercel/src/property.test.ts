import {
  type InvariantViolation,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import type { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';
import { z } from 'zod';

import { VercelConnector } from './vercel';

const CONNECTOR_ID = 'vercel';

function mockResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'application/json' }),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

function installFetchMock(
  routeBody: (url: string) => unknown,
): ReturnType<typeof vi.fn> {
  const spy = vi.fn().mockImplementation((url: string | URL) => {
    const u = typeof url === 'string' ? url : url.toString();
    return Promise.resolve(mockResponse(routeBody(u)));
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

type ProjectsSample = z.infer<typeof VercelConnector.schemas.projects>;
type DeploymentsSample = z.infer<typeof VercelConnector.schemas.deployments>;

describe('VercelConnector property tests', () => {
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
      const unique = new Set(sample.projects.map((p) => p.id)).size;
      const written = entityStoreFor(storage).get('vercel_project')?.size ?? 0;
      if (written !== unique) {
        violations.push({
          invariant: 'one vercel_project entity per unique project id',
          location: 'projects phase',
          detail: `expected ${unique} entities, got ${written}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest({
      connectorClass: VercelConnector,
      resource: 'projects',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [extra],
      run: async (sample, storage) => {
        // Force pagination to terminate after one page so the mocked fetch
        // doesn't loop forever — the connector follows `pagination.next`.
        const terminated = {
          ...sample,
          pagination: { ...sample.pagination, next: null },
        };
        installFetchMock(() => terminated);
        const connector = new VercelConnector(
          { resources: ['projects'] },
          { apiToken: 'vercel_test' as unknown as { $secret: string } },
        );
        await connector.sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('deployments: sync upholds universal invariants for any valid API payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: DeploymentsSample,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const unique = new Set(sample.deployments.map((d) => d.uid)).size;
      const written =
        entityStoreFor(storage).get('vercel_deployment')?.size ?? 0;
      if (written !== unique) {
        violations.push({
          invariant: 'one vercel_deployment entity per unique deployment uid',
          location: 'deployments phase',
          detail: `expected ${unique} entities, got ${written}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest({
      connectorClass: VercelConnector,
      resource: 'deployments',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [extra],
      run: async (sample, storage) => {
        const terminated = {
          ...sample,
          pagination: { ...sample.pagination, next: null },
        };
        installFetchMock(() => terminated);
        const connector = new VercelConnector(
          { resources: ['deployments'] },
          { apiToken: 'vercel_test' as unknown as { $secret: string } },
        );
        await connector.sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });
});
