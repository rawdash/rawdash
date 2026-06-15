import {
  type InvariantViolation,
  connectorResourceShapeViolations,
  entityStoreFor,
  eventStoreFor,
  installFetchMockAdvanced,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import type { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';
import { z } from 'zod';

import { EntraIdConnector } from './entra-id';

const CONNECTOR_ID = 'entra-id';
const CLIENT_SECRET = 'ENTRA_CLIENT_SECRET' as unknown as { $secret: string };

type UsersSample = z.infer<typeof EntraIdConnector.schemas.users>;
type SigninsSample = z.infer<typeof EntraIdConnector.schemas.signins>;
type RiskyUsersSample = z.infer<typeof EntraIdConnector.schemas.risky_users>;

const shapeViolationsExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    EntraIdConnector.resources,
    storage,
    connectorId,
  );

function uniqueUserEntityInvariant(
  storage: InMemoryStorage,
  _connectorId: string,
  sample: UsersSample,
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const unique = new Set(sample.value.map((u) => u.id)).size;
  const written =
    entityStoreFor(storage, CONNECTOR_ID).get('entra_user')?.size ?? 0;
  if (written !== unique) {
    violations.push({
      invariant: 'one entra_user entity per unique id',
      location: 'users phase',
      detail: `expected ${unique} entities, got ${written}`,
    });
  }
  return violations;
}

function signinEventCountInvariant(
  storage: InMemoryStorage,
  _connectorId: string,
  sample: SigninsSample,
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const valid = sample.value.filter((s) =>
    Number.isFinite(Date.parse(s.createdDateTime)),
  ).length;
  const events = eventStoreFor<{ name: string }>(storage, CONNECTOR_ID).filter(
    (e) => e.name === 'entra_signin_event',
  );
  if (events.length !== valid) {
    violations.push({
      invariant:
        'one entra_signin_event per audit log row with a parseable createdDateTime',
      location: 'signins phase',
      detail: `expected ${valid} events, got ${events.length}`,
    });
  }
  return violations;
}

function uniqueRiskyUserEntityInvariant(
  storage: InMemoryStorage,
  _connectorId: string,
  sample: RiskyUsersSample,
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const unique = new Set(sample.value.map((u) => u.id)).size;
  const written =
    entityStoreFor(storage, CONNECTOR_ID).get('entra_risky_user')?.size ?? 0;
  if (written !== unique) {
    violations.push({
      invariant: 'one entra_risky_user entity per unique id',
      location: 'risky_users phase',
      detail: `expected ${unique} entities, got ${written}`,
    });
  }
  return violations;
}

describe('EntraIdConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('users: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<UsersSample>({
      connectorClass: EntraIdConnector,
      resource: 'users',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [uniqueUserEntityInvariant, shapeViolationsExtra],
      run: async (sample, storage) => {
        installFetchMockAdvanced((u) => {
          if (u.includes('/oauth2/v2.0/token')) {
            return { body: { access_token: 'tok' } };
          }
          if (u.includes('graph.microsoft.com/v1.0/users')) {
            return { body: { value: sample.value } };
          }
          return { body: {} };
        });
        const c = new EntraIdConnector(
          {
            tenantId: 'contoso.onmicrosoft.com',
            resources: ['users'],
          },
          { clientId: 'AbCdEf', clientSecret: CLIENT_SECRET },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('signins: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<SigninsSample>({
      connectorClass: EntraIdConnector,
      resource: 'signins',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [signinEventCountInvariant, shapeViolationsExtra],
      run: async (sample, storage) => {
        installFetchMockAdvanced((u) => {
          if (u.includes('/oauth2/v2.0/token')) {
            return { body: { access_token: 'tok' } };
          }
          if (u.includes('/auditLogs/signIns')) {
            return { body: { value: sample.value } };
          }
          return { body: {} };
        });
        const c = new EntraIdConnector(
          {
            tenantId: 'contoso.onmicrosoft.com',
            resources: ['signins'],
          },
          { clientId: 'AbCdEf', clientSecret: CLIENT_SECRET },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('risky_users: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<RiskyUsersSample>({
      connectorClass: EntraIdConnector,
      resource: 'risky_users',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [uniqueRiskyUserEntityInvariant, shapeViolationsExtra],
      run: async (sample, storage) => {
        installFetchMockAdvanced((u) => {
          if (u.includes('/oauth2/v2.0/token')) {
            return { body: { access_token: 'tok' } };
          }
          if (u.includes('/identityProtection/riskyUsers')) {
            return { body: { value: sample.value } };
          }
          return { body: {} };
        });
        const c = new EntraIdConnector(
          {
            tenantId: 'contoso.onmicrosoft.com',
            resources: ['risky_users'],
          },
          { clientId: 'AbCdEf', clientSecret: CLIENT_SECRET },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });
});
