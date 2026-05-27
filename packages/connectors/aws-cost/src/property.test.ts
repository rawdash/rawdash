import {
  mockJsonResponse,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import { afterEach, describe, it, vi } from 'vitest';

import { AwsCostConnector } from './aws-cost';

const CONNECTOR_ID = 'aws-cost';

function makeConnector(): AwsCostConnector {
  return new AwsCostConnector(
    { region: 'us-east-1' },
    {
      accessKeyId: 'AKIAEXAMPLE' as unknown as { $secret: string },
      secretAccessKey: 'secret' as unknown as { $secret: string },
    },
  );
}

// Return the fuzzed payload for every Cost Explorer call, with any pagination
// token stripped so daily_cost pagination terminates after a single page.
function installMock(sample: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(() => {
      const body = { ...(sample as Record<string, unknown>) };
      delete body['NextPageToken'];
      return Promise.resolve(mockJsonResponse(body));
    }),
  );
}

describe('AwsCostConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('daily_cost: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest({
      connectorClass: AwsCostConnector,
      resource: 'daily_cost',
      connectorId: CONNECTOR_ID,
      runs: 50,
      run: async (sample, storage) => {
        installMock(sample);
        await makeConnector().sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('forecast: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest({
      connectorClass: AwsCostConnector,
      resource: 'forecast',
      connectorId: CONNECTOR_ID,
      runs: 50,
      run: async (sample, storage) => {
        installMock(sample);
        await makeConnector().sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });
});
