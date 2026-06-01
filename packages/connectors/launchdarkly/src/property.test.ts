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

import { LaunchDarklyConnector } from './launchdarkly';

const docShapeExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    LaunchDarklyConnector.resources,
    storage,
    connectorId,
  );

const CONNECTOR_ID = 'launchdarkly';

type ProjectsSample = z.infer<typeof LaunchDarklyConnector.schemas.projects>;
type FlagsSample = z.infer<typeof LaunchDarklyConnector.schemas.feature_flags>;
type AuditSample = z.infer<typeof LaunchDarklyConnector.schemas.audit_log>;

describe('LaunchDarklyConnector property tests', () => {
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
      const unique = new Set(sample.items.map((p) => p.key)).size;
      const written =
        entityStoreFor(storage, CONNECTOR_ID).get('launchdarkly_project')
          ?.size ?? 0;
      if (written !== unique) {
        violations.push({
          invariant: 'one launchdarkly_project entity per unique project key',
          location: 'projects phase',
          detail: `expected ${unique} entities, got ${written}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest({
      connectorClass: LaunchDarklyConnector,
      resource: 'projects',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [extra, docShapeExtra],
      run: async (sample, storage) => {
        // Strip _links.next so the mocked fetch terminates after one page.
        const terminated = { ...sample, _links: undefined };
        installFetchMock(() => terminated);
        const connector = new LaunchDarklyConnector(
          { resources: ['projects'] },
          { apiToken: 'api-test' as unknown as { $secret: string } },
        );
        await connector.sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('feature_flags: sync upholds universal invariants for any valid API payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: FlagsSample,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      // Flags are keyed by `${projectKey}:${flag.key}` and we feed a single
      // project ('p1') below, so the expected count is the number of unique
      // flag keys in the sample.
      const unique = new Set(sample.items.map((f) => f.key)).size;
      const written =
        entityStoreFor(storage, CONNECTOR_ID).get('launchdarkly_feature_flag')
          ?.size ?? 0;
      if (written !== unique) {
        violations.push({
          invariant:
            'one launchdarkly_feature_flag entity per unique flag key (within one project)',
          location: 'feature_flags phase',
          detail: `expected ${unique} entities, got ${written}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest({
      connectorClass: LaunchDarklyConnector,
      resource: 'feature_flags',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [extra, docShapeExtra],
      run: async (sample, storage) => {
        const terminated = { ...sample, _links: undefined };
        installFetchMock(() => terminated);
        const connector = new LaunchDarklyConnector(
          { resources: ['feature_flags'], projects: ['p1'] },
          { apiToken: 'api-test' as unknown as { $secret: string } },
        );
        await connector.sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('audit_log: sync upholds universal invariants for any valid API payload', async () => {
    await runPropertySyncTest({
      connectorClass: LaunchDarklyConnector,
      resource: 'audit_log',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [docShapeExtra],
      run: async (sample: AuditSample, storage) => {
        const terminated = { ...sample, _links: undefined };
        installFetchMock(() => terminated);
        const connector = new LaunchDarklyConnector(
          { resources: ['flag_events'] },
          { apiToken: 'api-test' as unknown as { $secret: string } },
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
      if (url.includes('/api/v2/projects')) {
        return {
          items: [{ _id: 'pid', key: 'p1', name: 'Project One', tags: [] }],
        };
      }
      if (url.includes('/api/v2/flags/p1')) {
        return {
          items: [
            {
              _id: 'fid',
              key: 'show-banner',
              name: 'Show Banner',
              kind: 'boolean',
              creationDate: 1714000000000,
              archived: false,
              tags: [],
              variations: [{ value: true }, { value: false }],
              environments: {
                production: {
                  on: true,
                  archived: false,
                  lastModified: 1715000000000,
                },
              },
            },
          ],
        };
      }
      if (url.includes('/api/v2/auditlog')) {
        return {
          items: [
            {
              _id: 'a1',
              kind: 'flag',
              date: Date.now() - 1_000,
              titleVerb: 'updated',
            },
          ],
        };
      }
      return { items: [] };
    });

    const storage = new InMemoryStorage();
    const connector = new LaunchDarklyConnector(
      {
        projects: ['p1'],
        resources: ['projects', 'feature_flags', 'flag_events'],
      },
      { apiToken: 'api-test' as unknown as { $secret: string } },
    );
    await connector.sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    assertConnectorResourceShapes(
      LaunchDarklyConnector.resources,
      storage,
      CONNECTOR_ID,
    );
  });
});
