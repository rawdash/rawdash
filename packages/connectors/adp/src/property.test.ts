import {
  type InvariantViolation,
  connectorResourceShapeViolations,
  installFetchMock,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import type { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';
import { z } from 'zod';

import { AdpConnector } from './adp';

const CONNECTOR_ID = 'adp';
const CREDS = {
  clientId: 'client-1',
  clientSecret: 'secret-1' as unknown as { $secret: string },
  certPem: 'cert' as unknown as { $secret: string },
  keyPem: 'key' as unknown as { $secret: string },
};

type WorkerSample = z.infer<typeof AdpConnector.schemas.workers>;
type PayrollSample = z.infer<typeof AdpConnector.schemas.payroll_output>;
type PayrollMetricSample = z.infer<
  typeof AdpConnector.schemas.payroll_output_metrics
>;

function tokenOr(body: unknown): (url: string) => unknown {
  return (url: string) =>
    url.includes('accounts.adp.com')
      ? { access_token: 'tok', expires_in: 3600 }
      : body;
}

const docShapeExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    AdpConnector.resources,
    storage,
    connectorId,
  );

describe('AdpConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('workers: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<WorkerSample>({
      connectorClass: AdpConnector,
      resource: 'workers',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock(tokenOr({ workers: sample }));
        const c = new AdpConnector({ resources: ['workers'] }, CREDS);
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('payrolls: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<PayrollSample>({
      connectorClass: AdpConnector,
      resource: 'payroll_output',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock(tokenOr({ payrollOutputs: sample }));
        const c = new AdpConnector({ resources: ['payrolls'] }, CREDS);
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('payroll metrics: derived samples uphold universal invariants', async () => {
    await runPropertySyncTest<PayrollMetricSample>({
      connectorClass: AdpConnector,
      resource: 'payroll_output_metrics',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock(tokenOr({ payrollOutputs: sample }));
        const c = new AdpConnector({ resources: ['payrolls'] }, CREDS);
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });
});
