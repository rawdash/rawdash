import {
  type InvariantViolation,
  connectorResourceShapeViolations,
  mockJsonResponse,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import type { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';

import { AnthropicConnector, type AnthropicResource } from './anthropic';

const CONNECTOR_ID = 'anthropic';

const docShapeExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    AnthropicConnector.resources,
    storage,
    connectorId,
  );

function makeConnector(
  resources: readonly AnthropicResource[],
): AnthropicConnector {
  return new AnthropicConnector(
    { resources, lookbackDays: 7 },
    {
      adminApiKey: 'sk-ant-admin-test' as unknown as { $secret: string },
    },
  );
}

function installMock(sample: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(() => {
      const body = { ...(sample as Record<string, unknown>) };
      delete body['next_page'];
      body['has_more'] = false;
      return Promise.resolve(mockJsonResponse(body));
    }),
  );
}

describe('AnthropicConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('usage_messages: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest({
      connectorClass: AnthropicConnector,
      resource: 'usage_messages',
      connectorId: CONNECTOR_ID,
      runs: 30,
      extraInvariants: [docShapeExtra],
      run: async (sample, storage) => {
        installMock(sample);
        await makeConnector([
          'anthropic_input_tokens',
          'anthropic_output_tokens',
          'anthropic_cache_read_tokens',
          'anthropic_cache_creation_tokens',
          'anthropic_web_search_requests',
        ]).sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('cost_report: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest({
      connectorClass: AnthropicConnector,
      resource: 'cost_report',
      connectorId: CONNECTOR_ID,
      runs: 30,
      extraInvariants: [docShapeExtra],
      run: async (sample, storage) => {
        installMock(sample);
        await makeConnector(['anthropic_cost_usd']).sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });
});
