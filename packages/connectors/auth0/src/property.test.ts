import {
  type InvariantViolation,
  connectorResourceShapeViolations,
  entityStoreFor,
  eventStoreFor,
  installFetchMockAdvanced,
  metricStoreFor,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import type { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';
import { z } from 'zod';

import { Auth0Connector } from './auth0';

const CONNECTOR_ID = 'auth0';
const CLIENT_SECRET = 'AUTH0_CLIENT_SECRET' as unknown as { $secret: string };

type UsersSample = z.infer<typeof Auth0Connector.schemas.users>;
type LogsSample = z.infer<typeof Auth0Connector.schemas.logs>;
type DailyStatsSample = z.infer<typeof Auth0Connector.schemas.daily_stats>;

const shapeViolationsExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    Auth0Connector.resources,
    storage,
    connectorId,
  );

function uniqueUserEntityInvariant(
  storage: InMemoryStorage,
  _connectorId: string,
  sample: UsersSample,
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const unique = new Set(sample.users.map((u) => u.user_id)).size;
  const written =
    entityStoreFor(storage, CONNECTOR_ID).get('auth0_user')?.size ?? 0;
  if (written !== unique) {
    violations.push({
      invariant: 'one auth0_user entity per unique user_id',
      location: 'users phase',
      detail: `expected ${unique} entities, got ${written}`,
    });
  }
  return violations;
}

function loginEventCountInvariant(
  storage: InMemoryStorage,
  _connectorId: string,
  sample: LogsSample,
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const valid = sample.filter(
    (l) =>
      Number.isFinite(Date.parse(l.date)) &&
      ['s', 'f', 'seacft', 'fp'].includes(l.type),
  ).length;
  const events = eventStoreFor<{ name: string }>(storage, CONNECTOR_ID).filter(
    (e) => e.name === 'auth0_login_event',
  );
  if (events.length !== valid) {
    violations.push({
      invariant:
        'one auth0_login_event per log row with a parseable date and a known type',
      location: 'login_events phase',
      detail: `expected ${valid} events, got ${events.length}`,
    });
  }
  return violations;
}

function dailyStatsMetricInvariant(
  storage: InMemoryStorage,
  _connectorId: string,
  sample: DailyStatsSample,
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  let expected = 0;
  for (const row of sample) {
    if (!Number.isFinite(Date.parse(row.date))) {
      continue;
    }
    if (typeof row.logins === 'number' && Number.isFinite(row.logins)) {
      expected += 1;
    }
    if (typeof row.signups === 'number' && Number.isFinite(row.signups)) {
      expected += 1;
    }
  }
  const samples = metricStoreFor<{ name: string }>(
    storage,
    CONNECTOR_ID,
  ).filter((s) => s.name === 'auth0_daily_active_users');
  if (samples.length !== expected) {
    violations.push({
      invariant:
        'one auth0_daily_active_users sample per (date, kind) for parseable rows with numeric values',
      location: 'daily_active_users phase',
      detail: `expected ${expected} samples, got ${samples.length}`,
    });
  }
  return violations;
}

describe('Auth0Connector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('users: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<UsersSample>({
      connectorClass: Auth0Connector,
      resource: 'users',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [uniqueUserEntityInvariant, shapeViolationsExtra],
      run: async (sample, storage) => {
        installFetchMockAdvanced((u) => {
          if (u.includes('/oauth/token')) {
            return { body: { access_token: 'tok' } };
          }
          if (u.includes('/api/v2/users')) {
            return {
              body: { users: sample.users, length: sample.users.length },
            };
          }
          return { body: {} };
        });
        const c = new Auth0Connector(
          {
            domain: 'acme.us.auth0.com',
            resources: ['users'],
          },
          { clientId: 'AbCdEf', clientSecret: CLIENT_SECRET },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('login_events: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<LogsSample>({
      connectorClass: Auth0Connector,
      resource: 'logs',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [loginEventCountInvariant, shapeViolationsExtra],
      run: async (sample, storage) => {
        installFetchMockAdvanced((u) => {
          if (u.includes('/oauth/token')) {
            return { body: { access_token: 'tok' } };
          }
          if (u.includes('/api/v2/logs')) {
            return { body: sample };
          }
          return { body: {} };
        });
        const c = new Auth0Connector(
          {
            domain: 'acme.us.auth0.com',
            resources: ['login_events'],
          },
          { clientId: 'AbCdEf', clientSecret: CLIENT_SECRET },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('daily_active_users: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<DailyStatsSample>({
      connectorClass: Auth0Connector,
      resource: 'daily_stats',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [dailyStatsMetricInvariant, shapeViolationsExtra],
      run: async (sample, storage) => {
        installFetchMockAdvanced((u) => {
          if (u.includes('/oauth/token')) {
            return { body: { access_token: 'tok' } };
          }
          if (u.includes('/api/v2/stats/daily')) {
            return { body: sample };
          }
          return { body: {} };
        });
        const c = new Auth0Connector(
          {
            domain: 'acme.us.auth0.com',
            resources: ['daily_active_users'],
          },
          { clientId: 'AbCdEf', clientSecret: CLIENT_SECRET },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });
});
