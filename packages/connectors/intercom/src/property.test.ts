import {
  type InvariantViolation,
  entityStoreFor,
  installFetchMock,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import type { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';
import { z } from 'zod';

import { IntercomConnector } from './intercom';

const CONNECTOR_ID = 'intercom';
const TOKEN = 'INTERCOM_TOKEN' as unknown as { $secret: string };

type AdminSample = z.infer<typeof IntercomConnector.schemas.admins>;
type TeamSample = z.infer<typeof IntercomConnector.schemas.teams>;
type ContactSample = z.infer<typeof IntercomConnector.schemas.contacts>;
type ConversationSample = z.infer<
  typeof IntercomConnector.schemas.conversations
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
  apiVersion: '2.11',
  region: 'us' as const,
};

describe('IntercomConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('admins: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<AdminSample>({
      connectorClass: IntercomConnector,
      resource: 'admins',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [uniqueEntityInvariant('intercom_admin', 'admins')],
      run: async (sample, storage) => {
        installFetchMock(() => ({ admins: sample }));
        const c = new IntercomConnector(
          { ...baseSettings, resources: ['admins'] },
          { accessToken: TOKEN },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('teams: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<TeamSample>({
      connectorClass: IntercomConnector,
      resource: 'teams',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [uniqueEntityInvariant('intercom_team', 'teams')],
      run: async (sample, storage) => {
        installFetchMock(() => ({ teams: sample }));
        const c = new IntercomConnector(
          { ...baseSettings, resources: ['teams'] },
          { accessToken: TOKEN },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('contacts: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<ContactSample>({
      connectorClass: IntercomConnector,
      resource: 'contacts',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [uniqueEntityInvariant('intercom_contact', 'contacts')],
      run: async (sample, storage) => {
        installFetchMock(() => ({ data: sample, pages: {} }));
        const c = new IntercomConnector(
          { ...baseSettings, resources: ['contacts'] },
          { accessToken: TOKEN },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('conversations: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<ConversationSample>({
      connectorClass: IntercomConnector,
      resource: 'conversations',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [
        uniqueEntityInvariant('intercom_conversation', 'conversations'),
      ],
      run: async (sample, storage) => {
        installFetchMock(() => ({ conversations: sample, pages: {} }));
        const c = new IntercomConnector(
          { ...baseSettings, resources: ['conversations'] },
          { accessToken: TOKEN },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });
});
