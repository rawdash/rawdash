import {
  type InvariantViolation,
  assertConnectorResourceShapes,
  connectorResourceShapeViolations,
  entityStoreFor,
  eventStoreFor,
  installFetchMockAdvanced,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import type { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';
import { z } from 'zod';

import { ClerkConnector } from './clerk';

const CONNECTOR_ID = 'clerk';
const SECRET_KEY = 'CLERK_SECRET_KEY' as unknown as { $secret: string };

type UsersSample = z.infer<typeof ClerkConnector.schemas.users>;
type OrganizationsSample = z.infer<typeof ClerkConnector.schemas.organizations>;
type SessionsSample = z.infer<typeof ClerkConnector.schemas.sessions>;

const shapeViolationsExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    ClerkConnector.resources,
    storage,
    connectorId,
  );

function uniqueUserEntityInvariant(
  storage: InMemoryStorage,
  _connectorId: string,
  sample: UsersSample,
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const unique = new Set(sample.map((u) => u.id)).size;
  const written =
    entityStoreFor(storage, CONNECTOR_ID).get('clerk_user')?.size ?? 0;
  if (written !== unique) {
    violations.push({
      invariant: 'one clerk_user entity per unique user id',
      location: 'users phase',
      detail: `expected ${unique} entities, got ${written}`,
    });
  }
  return violations;
}

function uniqueOrganizationEntityInvariant(
  storage: InMemoryStorage,
  _connectorId: string,
  sample: OrganizationsSample,
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const items = Array.isArray(sample) ? sample : sample.data;
  const unique = new Set(items.map((o) => o.id)).size;
  const written =
    entityStoreFor(storage, CONNECTOR_ID).get('clerk_organization')?.size ?? 0;
  if (written !== unique) {
    violations.push({
      invariant: 'one clerk_organization entity per unique organization id',
      location: 'organizations phase',
      detail: `expected ${unique} entities, got ${written}`,
    });
  }
  return violations;
}

function sessionEventCountInvariant(
  storage: InMemoryStorage,
  _connectorId: string,
  sample: SessionsSample,
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const valid = sample.filter(
    (s) => typeof s.created_at === 'number' && Number.isFinite(s.created_at),
  ).length;
  const events = eventStoreFor<{ name: string }>(storage, CONNECTOR_ID).filter(
    (e) => e.name === 'clerk_session',
  );
  if (events.length !== valid) {
    violations.push({
      invariant:
        'one clerk_session event per session row with a numeric created_at',
      location: 'sessions phase',
      detail: `expected ${valid} events, got ${events.length}`,
    });
  }
  return violations;
}

describe('ClerkConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('users: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<UsersSample>({
      connectorClass: ClerkConnector,
      resource: 'users',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [uniqueUserEntityInvariant, shapeViolationsExtra],
      run: async (sample, storage) => {
        installFetchMockAdvanced((u) => {
          if (u.includes('/v1/users')) {
            return { body: sample };
          }
          return { body: [] };
        });
        const c = new ClerkConnector(
          { resources: ['users'] },
          { secretKey: SECRET_KEY },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('organizations: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<OrganizationsSample>({
      connectorClass: ClerkConnector,
      resource: 'organizations',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [
        uniqueOrganizationEntityInvariant,
        shapeViolationsExtra,
      ],
      run: async (sample, storage) => {
        installFetchMockAdvanced((u) => {
          if (u.includes('/v1/organizations')) {
            return { body: sample };
          }
          return { body: [] };
        });
        const c = new ClerkConnector(
          { resources: ['organizations'] },
          { secretKey: SECRET_KEY },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('sessions: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<SessionsSample>({
      connectorClass: ClerkConnector,
      resource: 'sessions',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [sessionEventCountInvariant, shapeViolationsExtra],
      run: async (sample, storage) => {
        installFetchMockAdvanced((u) => {
          if (u.includes('/v1/sessions')) {
            return { body: sample };
          }
          return { body: [] };
        });
        const c = new ClerkConnector(
          { resources: ['sessions'] },
          { secretKey: SECRET_KEY },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('daily_active_users phase covers the resource shape requirement', async () => {
    const { InMemoryStorage } = await import('@rawdash/core');
    installFetchMockAdvanced((u) => {
      if (u.includes('/v1/users')) {
        return {
          body: [
            {
              id: 'user_dau_a',
              primary_email_address_id: null,
              email_addresses: [],
              last_sign_in_at: null,
              last_active_at: Date.now() - 60_000,
              created_at: Date.now() - 60_000,
              updated_at: Date.now() - 60_000,
              banned: false,
              locked: false,
            },
          ],
        };
      }
      return { body: [] };
    });
    const storage = new InMemoryStorage();
    const c = new ClerkConnector(
      { resources: ['daily_active_users'] },
      { secretKey: SECRET_KEY },
    );
    await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
    assertConnectorResourceShapes(
      ClerkConnector.resources,
      storage,
      CONNECTOR_ID,
    );
  });
});
