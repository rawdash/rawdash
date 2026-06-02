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

import { ZendeskConnector } from './zendesk';

const CONNECTOR_ID = 'zendesk';
const TOKEN = 'ZENDESK_TOKEN' as unknown as { $secret: string };

type UserSample = z.infer<typeof ZendeskConnector.schemas.users>;
type GroupSample = z.infer<typeof ZendeskConnector.schemas.groups>;
type TicketSample = z.infer<typeof ZendeskConnector.schemas.tickets>;
type SatisfactionRatingSample = z.infer<
  typeof ZendeskConnector.schemas.satisfaction_ratings
>;

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
    const records = sample as Array<{ id: number }>;
    const unique = new Set(records.map((r) => String(r.id))).size;
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
  subdomain: 'acme',
};

const baseCreds = { email: 'agent@acme.com', apiToken: TOKEN };

describe('ZendeskConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('users: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<UserSample>({
      connectorClass: ZendeskConnector,
      resource: 'users',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [
        uniqueEntityInvariant('zendesk_user', 'users'),
        (storage, connectorId) =>
          connectorResourceShapeViolations(
            ZendeskConnector.resources,
            storage,
            connectorId,
          ),
      ],
      run: async (sample, storage) => {
        installFetchMock(() => ({ users: sample, meta: {} }));
        const c = new ZendeskConnector(
          { ...baseSettings, resources: ['users'] },
          baseCreds,
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('groups: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<GroupSample>({
      connectorClass: ZendeskConnector,
      resource: 'groups',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [
        uniqueEntityInvariant('zendesk_group', 'groups'),
        (storage, connectorId) =>
          connectorResourceShapeViolations(
            ZendeskConnector.resources,
            storage,
            connectorId,
          ),
      ],
      run: async (sample, storage) => {
        installFetchMock(() => ({ groups: sample, meta: {} }));
        const c = new ZendeskConnector(
          { ...baseSettings, resources: ['groups'] },
          baseCreds,
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('tickets: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<TicketSample>({
      connectorClass: ZendeskConnector,
      resource: 'tickets',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [
        uniqueEntityInvariant('zendesk_ticket', 'tickets'),
        (storage, connectorId) =>
          connectorResourceShapeViolations(
            ZendeskConnector.resources,
            storage,
            connectorId,
          ),
      ],
      run: async (sample, storage) => {
        installFetchMock(() => ({ tickets: sample, end_of_stream: true }));
        const c = new ZendeskConnector(
          { ...baseSettings, resources: ['tickets'] },
          baseCreds,
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('satisfaction_ratings: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<SatisfactionRatingSample>({
      connectorClass: ZendeskConnector,
      resource: 'satisfaction_ratings',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [
        uniqueEntityInvariant(
          'zendesk_satisfaction_rating',
          'satisfaction_ratings',
        ),
        (storage, connectorId) =>
          connectorResourceShapeViolations(
            ZendeskConnector.resources,
            storage,
            connectorId,
          ),
      ],
      run: async (sample, storage) => {
        installFetchMock(() => ({
          satisfaction_ratings: sample,
          meta: {},
        }));
        const c = new ZendeskConnector(
          { ...baseSettings, resources: ['satisfaction_ratings'] },
          baseCreds,
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('full-sync resource shapes match the declared map (covers ticket_events)', async () => {
    const { InMemoryStorage } = await import('@rawdash/core');
    const storage = new InMemoryStorage();
    installFetchMock((url) => {
      if (url.includes('/incremental/tickets/cursor.json')) {
        return {
          tickets: [
            {
              id: 1,
              subject: 'help',
              status: 'solved',
              priority: 'normal',
              type: 'question',
              channel: 'email',
              assignee_id: 7,
              requester_id: 9,
              group_id: 3,
              tags: ['billing'],
              created_at: '2024-01-01T00:00:00Z',
              updated_at: '2024-01-02T00:00:00Z',
            },
          ],
          end_of_stream: true,
        };
      }
      if (url.includes('/api/v2/users.json')) {
        return { users: [], meta: {} };
      }
      if (url.includes('/api/v2/groups.json')) {
        return { groups: [], meta: {} };
      }
      if (url.includes('/api/v2/satisfaction_ratings.json')) {
        return { satisfaction_ratings: [], meta: {} };
      }
      return {};
    });
    const c = new ZendeskConnector(baseSettings, baseCreds);
    await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
    expect(() =>
      assertConnectorResourceShapes(
        ZendeskConnector.resources,
        storage,
        CONNECTOR_ID,
      ),
    ).not.toThrow();
  });
});
