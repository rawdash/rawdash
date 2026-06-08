import {
  type InvariantViolation,
  connectorResourceShapeViolations,
  entityStoreFor,
  installFetchMock,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { VercelConnector } from './vercel';

const docShapeExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    VercelConnector.resources,
    storage,
    connectorId,
  );

const CONNECTOR_ID = 'vercel';

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
      const written =
        entityStoreFor(storage, CONNECTOR_ID).get('vercel_project')?.size ?? 0;
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
      extraInvariants: [extra, docShapeExtra],
      run: async (sample, storage) => {
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
        entityStoreFor(storage, CONNECTOR_ID).get('vercel_deployment')?.size ??
        0;
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
      extraInvariants: [extra, docShapeExtra],
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

  it('full sync across all resources matches documented shapes', async () => {
    installFetchMock((url) => {
      if (url.includes('/v9/projects')) {
        return {
          projects: [
            {
              id: 'prj_1',
              name: 'web',
              framework: 'nextjs',
              createdAt: 1714521600000,
              updatedAt: 1714521700000,
            },
          ],
          pagination: { count: 1, next: null },
        };
      }
      return {
        deployments: [
          {
            uid: 'dpl_1',
            name: 'web',
            url: 'web-foo.vercel.app',
            created: 1714521600000,
            state: 'READY',
            target: 'production',
            creator: { uid: 'u_1', username: 'alice' },
            buildingAt: 1714521610000,
            ready: 1714521700000,
            source: 'git',
            meta: { githubCommitRef: 'main', githubCommitSha: 'deadbeef' },
            projectId: 'prj_1',
          },
        ],
        pagination: { count: 1, next: null },
      };
    });

    const storage = new InMemoryStorage();
    const connector = new VercelConnector(
      { resources: ['projects', 'deployments', 'deployment_events'] },
      { apiToken: 'vercel_test' as unknown as { $secret: string } },
    );
    await connector.sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    expect(
      connectorResourceShapeViolations(
        VercelConnector.resources,
        storage,
        CONNECTOR_ID,
      ),
    ).toEqual([]);
  });
});
