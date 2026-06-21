import {
  type InvariantViolation,
  connectorResourceShapeViolations,
  entityStoreFor,
  mockJsonResponse,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import type { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';
import { z } from 'zod';

import { MondayConnector } from './monday';

const CONNECTOR_ID = 'monday';

const docShapeExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    MondayConnector.resources,
    storage,
    connectorId,
  );

interface GraphQLCall {
  query: string;
  variables: Record<string, unknown>;
}

function operationName(query: string): string {
  return query.match(/query\s+(\w+)/)?.[1] ?? '';
}

function installGraphqlMock(
  responseFor: (
    op: string,
    variables: Record<string, unknown>,
  ) => Record<string, unknown>,
): ReturnType<typeof vi.fn> {
  const spy = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
    const parsed = JSON.parse(init.body as string) as GraphQLCall;
    const data = responseFor(operationName(parsed.query), parsed.variables);
    return Promise.resolve(mockJsonResponse({ data }));
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

function makeConnector(): MondayConnector {
  return new MondayConnector(
    {},
    { apiToken: 'tok' as unknown as { $secret: string } },
  );
}

type BoardsSample = z.infer<typeof MondayConnector.schemas.boards>;
type ItemsSample = z.infer<typeof MondayConnector.schemas.items>;
type ActivitySample = z.infer<typeof MondayConnector.schemas.activity_logs>;

describe('MondayConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('boards: sync upholds universal invariants for any valid API payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: BoardsSample,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const unique = new Set(sample.map((b) => b.id)).size;
      const written =
        entityStoreFor(storage, CONNECTOR_ID).get('monday_board')?.size ?? 0;
      if (written !== unique) {
        violations.push({
          invariant: 'one monday_board entity per unique board id',
          location: 'boards phase',
          detail: `expected ${unique} entities, got ${written}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest({
      connectorClass: MondayConnector,
      resource: 'boards',
      connectorId: CONNECTOR_ID,
      runs: 100,
      extraInvariants: [extra, docShapeExtra],
      run: async (sample, storage) => {
        installGraphqlMock((op, variables) => {
          if (op === 'Boards' && variables.page === 1) {
            return { boards: sample };
          }
          return { boards: [] };
        });
        await makeConnector().sync(
          { mode: 'full', resources: new Set(['boards']) },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('items: sync upholds universal invariants for any valid API payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: ItemsSample,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const unique = new Set(sample.map((i) => i.id)).size;
      const written =
        entityStoreFor(storage, CONNECTOR_ID).get('monday_item')?.size ?? 0;
      if (written !== unique) {
        violations.push({
          invariant: 'one monday_item entity per unique item id',
          location: 'items phase',
          detail: `expected ${unique} entities, got ${written}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest({
      connectorClass: MondayConnector,
      resource: 'items',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [extra, docShapeExtra],
      run: async (sample, storage) => {
        installGraphqlMock((op, variables) => {
          if (op === 'BoardItemsByPage' && variables.page === 1) {
            return {
              boards: [
                { id: 'b1', items_page: { cursor: null, items: sample } },
              ],
            };
          }
          return { boards: [] };
        });
        await makeConnector().sync(
          { mode: 'full', resources: new Set(['items']) },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('item_events: sync upholds resource-shape invariants for any valid API payload', async () => {
    await runPropertySyncTest({
      connectorClass: MondayConnector,
      resource: 'activity_logs',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [docShapeExtra],
      run: async (sample: ActivitySample, storage) => {
        installGraphqlMock((op, variables) => {
          if (
            op === 'BoardLogsByPage' &&
            variables.page === 1 &&
            variables.logPage === 1
          ) {
            return { boards: [{ id: 'b1', activity_logs: sample }] };
          }
          return { boards: [] };
        });
        await makeConnector().sync(
          { mode: 'full', resources: new Set(['item_events']) },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });
});
