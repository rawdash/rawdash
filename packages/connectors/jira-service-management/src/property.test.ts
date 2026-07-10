import {
  type InvariantViolation,
  assertConnectorResourceShapes,
  connectorResourceShapeViolations,
  entityStoreFor,
  installFetchMock,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import type { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { JiraServiceManagementConnector } from './jira-service-management';

const CONNECTOR_ID = 'jira-service-management';

const CREDS = {
  email: 'bot@acme.test' as unknown as { $secret: string },
  apiToken: 'jsm_token' as unknown as { $secret: string },
};

type ServiceDesksSample = z.infer<
  typeof JiraServiceManagementConnector.schemas.service_desks
>;
type RequestsSample = z.infer<
  typeof JiraServiceManagementConnector.schemas.requests
>;

const docShapeExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    JiraServiceManagementConnector.resources,
    storage,
    connectorId,
  );

function makeConnector(resources: string[]): JiraServiceManagementConnector {
  return new JiraServiceManagementConnector(
    { host: 'acme.atlassian.net', resources: resources as never },
    CREDS,
  );
}

describe('JiraServiceManagementConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('service_desks: sync upholds universal invariants for any valid API payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: ServiceDesksSample,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const unique = new Set(sample.values.map((d) => String(d.id))).size;
      const written =
        entityStoreFor(storage, CONNECTOR_ID).get('jsm_service_desk')?.size ??
        0;
      if (written !== unique) {
        violations.push({
          invariant: 'one jsm_service_desk entity per unique service desk id',
          location: 'service_desks phase',
          detail: `expected ${unique} entities, got ${written}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest<ServiceDesksSample>({
      connectorClass: JiraServiceManagementConnector,
      resource: 'service_desks',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [extra, docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock(() => ({ ...sample, isLastPage: true }));
        await makeConnector(['service_desks']).sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('requests: sync upholds universal invariants for any valid API payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: RequestsSample,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const unique = new Set(sample.issues.map((i) => i.id)).size;
      const written =
        entityStoreFor(storage, CONNECTOR_ID).get('jsm_request')?.size ?? 0;
      if (written !== unique) {
        violations.push({
          invariant: 'one jsm_request entity per unique request id',
          location: 'requests phase',
          detail: `expected ${unique} entities, got ${written}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest<RequestsSample>({
      connectorClass: JiraServiceManagementConnector,
      resource: 'requests',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [extra, docShapeExtra],
      run: async (sample, storage) => {
        const terminated = { ...sample, isLast: true, nextPageToken: null };
        installFetchMock((url) => {
          if (url.includes('/rest/api/3/search/jql')) {
            return terminated;
          }
          if (url.includes('/rest/servicedeskapi/servicedesk')) {
            return { values: [], isLastPage: true };
          }
          if (url.includes('/rest/api/3/field')) {
            return [];
          }
          return {};
        });
        await makeConnector(['requests']).sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('full-sync resource shapes match the declared map (covers events)', async () => {
    const { InMemoryStorage } = await import('@rawdash/core');
    const storage = new InMemoryStorage();
    installFetchMock((url) => {
      if (url.includes('/rest/servicedeskapi/servicedesk')) {
        return {
          values: [
            { id: '5', projectId: 900, projectKey: 'IT', projectName: 'IT' },
          ],
          isLastPage: true,
        };
      }
      if (url.includes('/rest/api/3/field')) {
        return [
          {
            id: 'customfield_10030',
            name: 'Time to resolution',
            schema: { custom: 'com.atlassian.servicedesk:sd-sla-field' },
          },
        ];
      }
      if (url.includes('/rest/api/3/search/jql')) {
        return {
          isLast: true,
          nextPageToken: null,
          issues: [
            {
              id: '1001',
              key: 'IT-1',
              fields: {
                summary: 'printer down',
                status: {
                  name: 'Waiting for support',
                  statusCategory: { key: 'indeterminate' },
                },
                priority: { name: 'High' },
                issuetype: { name: 'Service Request' },
                assignee: { accountId: 'a1' },
                reporter: { accountId: 'u1' },
                project: { id: '900', key: 'IT' },
                created: '2026-01-01T00:00:00.000Z',
                updated: '2026-01-02T00:00:00.000Z',
                resolutiondate: '2026-01-02T00:00:00.000Z',
                customfield_10030: {
                  completedCycles: [
                    {
                      startTime: { epochMillis: 1735689600000 },
                      stopTime: { epochMillis: 1735776000000 },
                      breached: false,
                      goalDuration: { millis: 28800000 },
                      elapsedTime: { millis: 3600000 },
                    },
                  ],
                },
              },
              changelog: {
                histories: [
                  {
                    id: 'h1',
                    created: '2026-01-02T00:00:00.000Z',
                    author: { accountId: 'a1' },
                    items: [
                      {
                        field: 'status',
                        fromString: 'Open',
                        toString: 'Waiting for support',
                      },
                    ],
                  },
                ],
              },
            },
          ],
        };
      }
      return {};
    });
    await new JiraServiceManagementConnector(
      { host: 'acme.atlassian.net' },
      CREDS,
    ).sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
    expect(() =>
      assertConnectorResourceShapes(
        JiraServiceManagementConnector.resources,
        storage,
        CONNECTOR_ID,
      ),
    ).not.toThrow();
  });
});
