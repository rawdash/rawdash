import {
  type InvariantViolation,
  connectorResourceShapeViolations,
  mockJsonResponse,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import type { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';

import { OpenAIConnector, type OpenAIResource } from './openai';

const CONNECTOR_ID = 'openai';

const docShapeExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    OpenAIConnector.resources,
    storage,
    connectorId,
  );

function makeConnector(resources: readonly OpenAIResource[]): OpenAIConnector {
  return new OpenAIConnector(
    { resources, lookbackDays: 7 },
    { adminApiKey: 'sk-admin-test' },
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

describe('OpenAIConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('usage_completions: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest({
      connectorClass: OpenAIConnector,
      resource: 'usage_completions',
      connectorId: CONNECTOR_ID,
      runs: 30,
      extraInvariants: [docShapeExtra],
      run: async (sample, storage) => {
        installMock(sample);
        await makeConnector([
          'openai_completions_input_tokens',
          'openai_completions_output_tokens',
          'openai_completions_requests',
        ]).sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('usage_embeddings: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest({
      connectorClass: OpenAIConnector,
      resource: 'usage_embeddings',
      connectorId: CONNECTOR_ID,
      runs: 30,
      extraInvariants: [docShapeExtra],
      run: async (sample, storage) => {
        installMock(sample);
        await makeConnector([
          'openai_embeddings_input_tokens',
          'openai_embeddings_requests',
        ]).sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('usage_images: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest({
      connectorClass: OpenAIConnector,
      resource: 'usage_images',
      connectorId: CONNECTOR_ID,
      runs: 30,
      extraInvariants: [docShapeExtra],
      run: async (sample, storage) => {
        installMock(sample);
        await makeConnector([
          'openai_images_count',
          'openai_images_requests',
        ]).sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('usage_audio_speeches: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest({
      connectorClass: OpenAIConnector,
      resource: 'usage_audio_speeches',
      connectorId: CONNECTOR_ID,
      runs: 30,
      extraInvariants: [docShapeExtra],
      run: async (sample, storage) => {
        installMock(sample);
        await makeConnector([
          'openai_audio_speeches_characters',
          'openai_audio_speeches_requests',
        ]).sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('usage_audio_transcriptions: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest({
      connectorClass: OpenAIConnector,
      resource: 'usage_audio_transcriptions',
      connectorId: CONNECTOR_ID,
      runs: 30,
      extraInvariants: [docShapeExtra],
      run: async (sample, storage) => {
        installMock(sample);
        await makeConnector([
          'openai_audio_transcriptions_seconds',
          'openai_audio_transcriptions_requests',
        ]).sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('costs: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest({
      connectorClass: OpenAIConnector,
      resource: 'costs',
      connectorId: CONNECTOR_ID,
      runs: 30,
      extraInvariants: [docShapeExtra],
      run: async (sample, storage) => {
        installMock(sample);
        await makeConnector(['openai_cost_usd']).sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });
});
