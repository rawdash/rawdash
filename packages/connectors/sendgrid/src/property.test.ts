import {
  type InvariantViolation,
  connectorResourceShapeViolations,
  eventStoreFor,
  installFetchMockAdvanced,
  metricStoreFor,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import type { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';
import { z } from 'zod';

import { SendgridConnector } from './sendgrid';

const CONNECTOR_ID = 'sendgrid';
const API_KEY = 'SENDGRID_API_KEY' as unknown as { $secret: string };

type StatsSample = z.infer<typeof SendgridConnector.schemas.email_stats>;
type BouncesSample = z.infer<typeof SendgridConnector.schemas.bounces>;
type SpamReportsSample = z.infer<typeof SendgridConnector.schemas.spam_reports>;

const shapeViolationsExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    SendgridConnector.resources,
    storage,
    connectorId,
  );

function parseableDay(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}/.test(date);
}

function finiteSeconds(created: number): boolean {
  return Number.isFinite(created * 1000);
}

function statsMetricInvariant(
  storage: InMemoryStorage,
  _connectorId: string,
  sample: StatsSample,
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  let expected = 0;
  for (const day of sample) {
    if (!parseableDay(day.date)) {
      continue;
    }
    expected += day.stats?.length ?? 0;
  }
  const samples = metricStoreFor<{ name: string }>(
    storage,
    CONNECTOR_ID,
  ).filter((s) => s.name === 'sendgrid_email_stats');
  if (samples.length !== expected) {
    violations.push({
      invariant:
        'one sendgrid_email_stats sample per (day, stats entry) for parseable days',
      location: 'email_stats phase',
      detail: `expected ${expected} samples, got ${samples.length}`,
    });
  }
  return violations;
}

function bounceEventInvariant(
  storage: InMemoryStorage,
  _connectorId: string,
  sample: BouncesSample,
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const expected = sample.filter((b) => finiteSeconds(b.created)).length;
  const events = eventStoreFor<{ name: string }>(storage, CONNECTOR_ID).filter(
    (e) => e.name === 'sendgrid_bounce',
  );
  if (events.length !== expected) {
    violations.push({
      invariant: 'one sendgrid_bounce event per row with a finite created time',
      location: 'bounces phase',
      detail: `expected ${expected} events, got ${events.length}`,
    });
  }
  return violations;
}

function spamReportEventInvariant(
  storage: InMemoryStorage,
  _connectorId: string,
  sample: SpamReportsSample,
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const expected = sample.filter((s) => finiteSeconds(s.created)).length;
  const events = eventStoreFor<{ name: string }>(storage, CONNECTOR_ID).filter(
    (e) => e.name === 'sendgrid_spam_report',
  );
  if (events.length !== expected) {
    violations.push({
      invariant:
        'one sendgrid_spam_report event per row with a finite created time',
      location: 'spam_reports phase',
      detail: `expected ${expected} events, got ${events.length}`,
    });
  }
  return violations;
}

describe('SendgridConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('email_stats: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<StatsSample>({
      connectorClass: SendgridConnector,
      resource: 'email_stats',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [statsMetricInvariant, shapeViolationsExtra],
      run: async (sample, storage) => {
        installFetchMockAdvanced((u) => {
          if (u.includes('/stats')) {
            return { body: sample };
          }
          return { body: [] };
        });
        const c = new SendgridConnector(
          { resources: ['email_stats'] },
          { apiKey: API_KEY },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('bounces: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<BouncesSample>({
      connectorClass: SendgridConnector,
      resource: 'bounces',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [bounceEventInvariant, shapeViolationsExtra],
      run: async (sample, storage) => {
        installFetchMockAdvanced((u) => {
          if (u.includes('/suppression/bounces')) {
            if (Number(new URL(u).searchParams.get('offset')) > 0) {
              return { body: [] };
            }
            return { body: sample };
          }
          return { body: [] };
        });
        const c = new SendgridConnector(
          { resources: ['bounces'] },
          { apiKey: API_KEY },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('spam_reports: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<SpamReportsSample>({
      connectorClass: SendgridConnector,
      resource: 'spam_reports',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [spamReportEventInvariant, shapeViolationsExtra],
      run: async (sample, storage) => {
        installFetchMockAdvanced((u) => {
          if (u.includes('/suppression/spam_reports')) {
            if (Number(new URL(u).searchParams.get('offset')) > 0) {
              return { body: [] };
            }
            return { body: sample };
          }
          return { body: [] };
        });
        const c = new SendgridConnector(
          { resources: ['spam_reports'] },
          { apiKey: API_KEY },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });
});
