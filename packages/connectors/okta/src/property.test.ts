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

import { OktaConnector } from './okta';

const CONNECTOR_ID = 'okta';
const TOKEN = 'OKTA_API_TOKEN' as unknown as { $secret: string };

type UserSample = z.infer<typeof OktaConnector.schemas.users>;
type GroupSample = z.infer<typeof OktaConnector.schemas.groups>;
type LogEventSample = z.infer<typeof OktaConnector.schemas.auth_events>;

function uniqueEntityInvariant(
  entityType: string,
  phase: string,
): (
  storage: InMemoryStorage,
  connectorId: string,
  sample: unknown[],
) => InvariantViolation[] {
  return (storage, _connectorId, sample) => {
    const violations: InvariantViolation[] = [];
    const records = sample as Array<{ id: string }>;
    const unique = new Set(records.map((r) => r.id)).size;
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

const baseSettings = {
  host: 'acme.okta.com',
};

const baseCreds = { apiToken: TOKEN };

describe('OktaConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('users: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<UserSample>({
      connectorClass: OktaConnector,
      resource: 'users',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [
        uniqueEntityInvariant('okta_user', 'users'),
        (storage, connectorId) =>
          connectorResourceShapeViolations(
            OktaConnector.resources,
            storage,
            connectorId,
          ),
      ],
      run: async (sample, storage) => {
        installFetchMock(() => sample);
        const c = new OktaConnector(
          { ...baseSettings, resources: ['users'] },
          baseCreds,
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('groups: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<GroupSample>({
      connectorClass: OktaConnector,
      resource: 'groups',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [
        uniqueEntityInvariant('okta_group', 'groups'),
        (storage, connectorId) =>
          connectorResourceShapeViolations(
            OktaConnector.resources,
            storage,
            connectorId,
          ),
      ],
      run: async (sample, storage) => {
        installFetchMock(() => sample);
        const c = new OktaConnector(
          { ...baseSettings, resources: ['groups'] },
          baseCreds,
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('auth_events: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<LogEventSample>({
      connectorClass: OktaConnector,
      resource: 'auth_events',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [
        (storage, connectorId) =>
          connectorResourceShapeViolations(
            OktaConnector.resources,
            storage,
            connectorId,
          ),
      ],
      run: async (sample, storage) => {
        installFetchMock(() => sample);
        const c = new OktaConnector(
          { ...baseSettings, resources: ['auth_events'] },
          baseCreds,
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('full-sync resource shapes match the declared map', async () => {
    const { InMemoryStorage } = await import('@rawdash/core');
    const storage = new InMemoryStorage();
    installFetchMock((url) => {
      if (url.includes('/api/v1/users')) {
        return [
          {
            id: '00u123',
            status: 'ACTIVE',
            created: '2024-01-01T00:00:00Z',
            lastUpdated: '2024-02-01T00:00:00Z',
            profile: { email: 'ada@example.com', login: 'ada@example.com' },
          },
        ];
      }
      if (url.includes('/api/v1/groups')) {
        return [
          {
            id: '00g456',
            type: 'OKTA_GROUP',
            created: '2024-01-01T00:00:00Z',
            lastUpdated: '2024-02-01T00:00:00Z',
            profile: { name: 'Engineering' },
          },
        ];
      }
      if (url.includes('/api/v1/logs')) {
        return [
          {
            uuid: 'evt-1',
            published: '2024-02-01T12:00:00Z',
            eventType: 'user.session.start',
            outcome: { result: 'SUCCESS' },
          },
        ];
      }
      return [];
    });
    const c = new OktaConnector(baseSettings, baseCreds);
    await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
    expect(() =>
      assertConnectorResourceShapes(
        OktaConnector.resources,
        storage,
        CONNECTOR_ID,
      ),
    ).not.toThrow();
  });
});
