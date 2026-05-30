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

import { SentryConnector } from './sentry';

const docShapeExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    SentryConnector.resources,
    storage,
    connectorId,
  );

const CONNECTOR_ID = 'sentry';

type IssuesSample = z.infer<typeof SentryConnector.schemas.issues>;
type ReleasesSample = z.infer<typeof SentryConnector.schemas.releases>;

describe('SentryConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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
        entityStoreFor(storage, CONNECTOR_ID).get('sentry_issue')?.size ?? 0;
      if (written !== unique) {
        violations.push({
          invariant: 'one sentry_issue entity per unique issue id',
          location: 'issues phase',
          detail: `expected ${unique} entities, got ${written}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest({
      connectorClass: SentryConnector,
      resource: 'issues',
      connectorId: CONNECTOR_ID,
      runs: 100,
      extraInvariants: [extra, docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock(() => sample);
        const connector = new SentryConnector(
          { organization: 'acme', resources: ['issues'] },
          { authToken: 'sntrys_test' as unknown as { $secret: string } },
        );
        await connector.sync(
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
      sample: ReleasesSample,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const unique = new Set(sample.map((r) => r.version)).size;
      const written =
        entityStoreFor(storage, CONNECTOR_ID).get('sentry_release')?.size ?? 0;
      if (written !== unique) {
        violations.push({
          invariant: 'one sentry_release entity per unique version',
          location: 'releases phase',
          detail: `expected ${unique} entities, got ${written}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest({
      connectorClass: SentryConnector,
      resource: 'releases',
      connectorId: CONNECTOR_ID,
      runs: 100,
      extraInvariants: [extra, docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock(() => sample);
        const connector = new SentryConnector(
          { organization: 'acme', resources: ['releases'] },
          { authToken: 'sntrys_test' as unknown as { $secret: string } },
        );
        await connector.sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('full sync across all resources matches the connector doc shapes', async () => {
    installFetchMock((url) => {
      if (url.includes('/issues/i-1/events/')) {
        return [
          {
            eventID: 'ev-1',
            dateCreated: '2024-05-02T01:00:00.000Z',
            platform: 'javascript',
            environment: 'production',
            message: 'TypeError',
          },
        ];
      }
      if (url.includes('/issues/')) {
        return [
          {
            id: 'i-1',
            shortId: 'ACME-1',
            title: 'Boom',
            level: 'error',
            status: 'unresolved',
            firstSeen: '2024-05-01T00:00:00.000Z',
            lastSeen: '2024-05-02T00:00:00.000Z',
            count: '42',
            userCount: 10,
            project: { slug: 'web' },
          },
        ];
      }
      if (url.includes('/releases/')) {
        return [
          {
            version: '1.2.3',
            dateCreated: '2024-05-01T00:00:00.000Z',
            dateReleased: '2024-05-02T00:00:00.000Z',
            lastEvent: '2024-05-03T00:00:00.000Z',
            projects: [{ slug: 'web' }, { slug: 'api' }],
          },
        ];
      }
      if (url.includes('/stats_v2/')) {
        return {
          intervals: ['2024-05-01T00:00:00.000Z', '2024-05-01T01:00:00.000Z'],
          groups: [
            { by: { project: 'web' }, series: { 'sum(quantity)': [10, 5] } },
          ],
        };
      }
      return [];
    });

    const storage = new InMemoryStorage();
    const connector = new SentryConnector(
      {
        organization: 'acme',
        resources: ['issues', 'issue_events', 'releases', 'errors_per_hour'],
      },
      { authToken: 'sntrys_test' as unknown as { $secret: string } },
    );
    await connector.sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    assertConnectorResourceShapes(
      SentryConnector.resources,
      storage,
      CONNECTOR_ID,
    );
  });
});
