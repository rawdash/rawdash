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

import { WorkOSConnector } from './workos';

const CONNECTOR_ID = 'workos';
const API_KEY = 'WORKOS_API_KEY' as unknown as { $secret: string };

type OrganizationsSample = z.infer<
  typeof WorkOSConnector.schemas.organizations
>;
type ConnectionsSample = z.infer<typeof WorkOSConnector.schemas.connections>;
type DirectoriesSample = z.infer<typeof WorkOSConnector.schemas.directories>;
type AuthEventsSample = z.infer<typeof WorkOSConnector.schemas.auth_events>;

const shapeViolationsExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    WorkOSConnector.resources,
    storage,
    connectorId,
  );

function uniqueOrganizationInvariant(
  storage: InMemoryStorage,
  _connectorId: string,
  sample: OrganizationsSample,
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const unique = new Set(sample.data.map((o) => o.id)).size;
  const written =
    entityStoreFor(storage, CONNECTOR_ID).get('workos_organization')?.size ?? 0;
  if (written !== unique) {
    violations.push({
      invariant: 'one workos_organization entity per unique id',
      location: 'organizations phase',
      detail: `expected ${unique} entities, got ${written}`,
    });
  }
  return violations;
}

function uniqueConnectionInvariant(
  storage: InMemoryStorage,
  _connectorId: string,
  sample: ConnectionsSample,
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const unique = new Set(sample.data.map((c) => c.id)).size;
  const written =
    entityStoreFor(storage, CONNECTOR_ID).get('workos_connection')?.size ?? 0;
  if (written !== unique) {
    violations.push({
      invariant: 'one workos_connection entity per unique id',
      location: 'connections phase',
      detail: `expected ${unique} entities, got ${written}`,
    });
  }
  return violations;
}

function uniqueDirectoryInvariant(
  storage: InMemoryStorage,
  _connectorId: string,
  sample: DirectoriesSample,
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const unique = new Set(sample.data.map((d) => d.id)).size;
  const written =
    entityStoreFor(storage, CONNECTOR_ID).get('workos_directory')?.size ?? 0;
  if (written !== unique) {
    violations.push({
      invariant: 'one workos_directory entity per unique id',
      location: 'directories phase',
      detail: `expected ${unique} entities, got ${written}`,
    });
  }
  return violations;
}

const AUTH_EVENT_TYPES = new Set([
  'authentication.email_verification_succeeded',
  'authentication.magic_auth_succeeded',
  'authentication.magic_auth_failed',
  'authentication.mfa_succeeded',
  'authentication.mfa_failed',
  'authentication.oauth_succeeded',
  'authentication.oauth_failed',
  'authentication.password_succeeded',
  'authentication.password_failed',
  'authentication.sso_succeeded',
  'authentication.sso_failed',
]);

function authEventCountInvariant(
  storage: InMemoryStorage,
  _connectorId: string,
  sample: AuthEventsSample,
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const valid = sample.data.filter(
    (e) =>
      AUTH_EVENT_TYPES.has(e.event) &&
      Number.isFinite(Date.parse(e.created_at)),
  ).length;
  const events = eventStoreFor<{ name: string }>(storage, CONNECTOR_ID).filter(
    (e) => e.name === 'workos_auth_event',
  );
  if (events.length !== valid) {
    violations.push({
      invariant:
        'one workos_auth_event per event with a known authentication.* type and parseable created_at',
      location: 'auth_events phase',
      detail: `expected ${valid} events, got ${events.length}`,
    });
  }
  return violations;
}

describe('WorkOSConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('organizations: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<OrganizationsSample>({
      connectorClass: WorkOSConnector,
      resource: 'organizations',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [uniqueOrganizationInvariant, shapeViolationsExtra],
      run: async (sample, storage) => {
        installFetchMockAdvanced((u) => {
          if (u.includes('/organizations')) {
            return {
              body: {
                data: sample.data,
                list_metadata: { before: null, after: null },
              },
            };
          }
          return {
            body: { data: [], list_metadata: { before: null, after: null } },
          };
        });
        const c = new WorkOSConnector(
          { resources: ['organizations'] },
          { apiKey: API_KEY },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('connections: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<ConnectionsSample>({
      connectorClass: WorkOSConnector,
      resource: 'connections',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [uniqueConnectionInvariant, shapeViolationsExtra],
      run: async (sample, storage) => {
        installFetchMockAdvanced((u) => {
          if (u.includes('/connections')) {
            return {
              body: {
                data: sample.data,
                list_metadata: { before: null, after: null },
              },
            };
          }
          return {
            body: { data: [], list_metadata: { before: null, after: null } },
          };
        });
        const c = new WorkOSConnector(
          { resources: ['connections'] },
          { apiKey: API_KEY },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('directories: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<DirectoriesSample>({
      connectorClass: WorkOSConnector,
      resource: 'directories',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [uniqueDirectoryInvariant, shapeViolationsExtra],
      run: async (sample, storage) => {
        installFetchMockAdvanced((u) => {
          if (u.includes('/directories')) {
            return {
              body: {
                data: sample.data,
                list_metadata: { before: null, after: null },
              },
            };
          }
          return {
            body: { data: [], list_metadata: { before: null, after: null } },
          };
        });
        const c = new WorkOSConnector(
          { resources: ['directories'] },
          { apiKey: API_KEY },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('auth_events: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<AuthEventsSample>({
      connectorClass: WorkOSConnector,
      resource: 'auth_events',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [authEventCountInvariant, shapeViolationsExtra],
      run: async (sample, storage) => {
        installFetchMockAdvanced((u) => {
          if (u.includes('/events')) {
            return {
              body: {
                data: sample.data,
                list_metadata: { before: null, after: null },
              },
            };
          }
          return {
            body: { data: [], list_metadata: { before: null, after: null } },
          };
        });
        const c = new WorkOSConnector(
          { resources: ['auth_events'] },
          { apiKey: API_KEY },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });
});
