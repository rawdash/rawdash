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

import { CircleCIConnector } from './circleci';

const CONNECTOR_ID = 'circleci';

const docShapeExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    CircleCIConnector.resources,
    storage,
    connectorId,
  );

type PipelinesSample = z.infer<typeof CircleCIConnector.schemas.pipelines>;
type WorkflowsSample = z.infer<typeof CircleCIConnector.schemas.workflows>;
type JobsSample = z.infer<typeof CircleCIConnector.schemas.jobs>;

describe('CircleCIConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('pipelines: sync upholds universal invariants for any valid API payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: PipelinesSample,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const validIds = sample.items.filter((p) => {
        const created = Date.parse(p.created_at);
        const updated = Date.parse(p.updated_at);
        return Number.isFinite(created) && Number.isFinite(updated);
      });
      const unique = new Set(validIds.map((p) => p.id)).size;
      const written =
        entityStoreFor(storage, CONNECTOR_ID).get('circleci_pipeline')?.size ??
        0;
      if (written !== unique) {
        violations.push({
          invariant:
            'one circleci_pipeline entity per unique pipeline id with parseable timestamps',
          location: 'pipelines phase',
          detail: `expected ${unique} entities, got ${written}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest({
      connectorClass: CircleCIConnector,
      resource: 'pipelines',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [extra, docShapeExtra],
      run: async (sample, storage) => {
        const terminated = { ...sample, next_page_token: null };
        installFetchMock((url) => {
          if (url.includes('/workflow')) {
            return { items: [], next_page_token: null };
          }
          return terminated;
        });
        const connector = new CircleCIConnector(
          {
            projectSlugs: ['gh/my-org/my-repo'],
            resources: ['pipelines', 'workflows', 'pipeline_events'],
            pipelinesLookbackDays: 365 * 50,
          },
          { apiToken: 'ccitest' as unknown as { $secret: string } },
        );
        await connector.sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('workflows: sync upholds universal invariants for any valid API payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: WorkflowsSample,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const validIds = sample.items.filter((w) =>
        Number.isFinite(Date.parse(w.created_at)),
      );
      const unique = new Set(validIds.map((w) => w.id)).size;
      const written =
        entityStoreFor(storage, CONNECTOR_ID).get('circleci_workflow')?.size ??
        0;
      if (written !== unique) {
        violations.push({
          invariant:
            'one circleci_workflow entity per unique workflow id with parseable created_at',
          location: 'workflows phase',
          detail: `expected ${unique} entities, got ${written}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest({
      connectorClass: CircleCIConnector,
      resource: 'workflows',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [extra, docShapeExtra],
      run: async (sample, storage) => {
        const terminated = { ...sample, next_page_token: null };
        installFetchMock((url) => {
          if (url.includes('/workflow')) {
            return terminated;
          }
          return {
            items: [
              {
                id: 'pid-1',
                number: 1,
                project_slug: 'gh/my-org/my-repo',
                state: 'created',
                created_at: '2024-05-01T00:00:00.000Z',
                updated_at: '2024-05-01T00:00:00.000Z',
              },
            ],
            next_page_token: null,
          };
        });
        const connector = new CircleCIConnector(
          {
            projectSlugs: ['gh/my-org/my-repo'],
            resources: ['workflows'],
            pipelinesLookbackDays: 365 * 50,
          },
          { apiToken: 'ccitest' as unknown as { $secret: string } },
        );
        await connector.sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('jobs: sync upholds universal invariants for any valid API payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: JobsSample,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const unique = new Set(sample.items.map((j) => j.id)).size;
      const written =
        entityStoreFor(storage, CONNECTOR_ID).get('circleci_job')?.size ?? 0;
      if (written !== unique) {
        violations.push({
          invariant: 'one circleci_job entity per unique job id',
          location: 'jobs phase',
          detail: `expected ${unique} entities, got ${written}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest({
      connectorClass: CircleCIConnector,
      resource: 'jobs',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [extra, docShapeExtra],
      run: async (sample, storage) => {
        const terminated = { ...sample, next_page_token: null };
        installFetchMock((url) => {
          if (url.includes('/job')) {
            return terminated;
          }
          if (url.includes('/workflow')) {
            return {
              items: [
                {
                  id: 'wid-1',
                  name: 'wf',
                  pipeline_id: 'pid-1',
                  project_slug: 'gh/my-org/my-repo',
                  status: 'success',
                  created_at: '2024-05-01T00:00:00.000Z',
                  stopped_at: null,
                },
              ],
              next_page_token: null,
            };
          }
          return {
            items: [
              {
                id: 'pid-1',
                number: 1,
                project_slug: 'gh/my-org/my-repo',
                state: 'created',
                created_at: '2024-05-01T00:00:00.000Z',
                updated_at: '2024-05-01T00:00:00.000Z',
              },
            ],
            next_page_token: null,
          };
        });
        const connector = new CircleCIConnector(
          {
            projectSlugs: ['gh/my-org/my-repo'],
            resources: ['jobs'],
            pipelinesLookbackDays: 365 * 50,
          },
          { apiToken: 'ccitest' as unknown as { $secret: string } },
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
      if (url.includes('/job')) {
        return {
          items: [
            {
              id: 'jid-1',
              name: 'test',
              status: 'success',
              type: 'build',
              job_number: 1,
              started_at: '2024-05-01T00:00:00.000Z',
              stopped_at: '2024-05-01T00:00:30.000Z',
              project_slug: 'gh/my-org/my-repo',
            },
          ],
          next_page_token: null,
        };
      }
      if (url.includes('/workflow')) {
        return {
          items: [
            {
              id: 'wid-1',
              name: 'wf',
              pipeline_id: 'pid-1',
              project_slug: 'gh/my-org/my-repo',
              status: 'success',
              created_at: '2024-05-01T00:00:00.000Z',
              stopped_at: '2024-05-01T00:01:00.000Z',
            },
          ],
          next_page_token: null,
        };
      }
      return {
        items: [
          {
            id: 'pid-1',
            number: 1,
            project_slug: 'gh/my-org/my-repo',
            state: 'created',
            created_at: '2024-05-01T00:00:00.000Z',
            updated_at: '2024-05-01T00:00:00.000Z',
            vcs: { branch: 'main', revision: 'deadbeef' },
          },
        ],
        next_page_token: null,
      };
    });

    const storage = new InMemoryStorage();
    const connector = new CircleCIConnector(
      {
        projectSlugs: ['gh/my-org/my-repo'],
        resources: ['pipelines', 'workflows', 'jobs', 'pipeline_events'],
        pipelinesLookbackDays: 365 * 50,
      },
      { apiToken: 'ccitest' as unknown as { $secret: string } },
    );
    await connector.sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    expect(
      connectorResourceShapeViolations(
        CircleCIConnector.resources,
        storage,
        CONNECTOR_ID,
      ),
    ).toEqual([]);
  });
});
