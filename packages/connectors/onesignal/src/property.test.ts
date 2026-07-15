import {
  type InvariantViolation,
  assertConnectorResourceShapes,
  connectorResourceShapeViolations,
  installFetchMock,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';
import type { z } from 'zod';

import { OneSignalConnector } from './onesignal';

const CONNECTOR_ID = 'onesignal';
const KEY = 'ONESIGNAL_REST_API_KEY' as unknown as { $secret: string };
const APP_ID = '00000000-0000-0000-0000-000000000000';

const docShapeExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    OneSignalConnector.resources,
    storage,
    connectorId,
  );

type NotificationsSample = z.infer<
  typeof OneSignalConnector.schemas.notifications
>;
type StatsSample = z.infer<
  typeof OneSignalConnector.schemas.notification_stats
>;

function makeConnector(resources?: string[]) {
  return new OneSignalConnector(
    { appId: APP_ID, resources: resources as never },
    { apiKey: KEY },
  );
}

describe('OneSignalConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('notifications: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<NotificationsSample>({
      connectorClass: OneSignalConnector,
      resource: 'notifications',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock(() => ({ ...sample, notifications: [] }));
        await makeConnector(['notifications']).sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('notification_stats: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<StatsSample>({
      connectorClass: OneSignalConnector,
      resource: 'notification_stats',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock(() => ({ ...sample, notifications: [] }));
        await makeConnector(['notification_stats']).sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('full sync across all resources matches documented resource shapes', async () => {
    const notification = {
      id: 'n_1',
      name: 'Welcome push',
      contents: { en: 'Welcome to the app' },
      headings: { en: 'Hello' },
      url: 'https://example.com',
      successful: 900,
      failed: 50,
      errored: 10,
      converted: 120,
      received: 850,
      remaining: 0,
      canceled: false,
      queued_at: 1_768_000_000,
      send_after: 1_768_000_000,
      completed_at: 1_768_000_100,
    };
    let calls = 0;
    installFetchMock((url: string) => {
      if (url.includes('/notifications')) {
        const page = calls === 0 ? [notification] : [];
        calls += 1;
        return {
          total_count: 1,
          offset: 0,
          limit: 50,
          notifications: page,
        };
      }
      throw new Error(`unexpected request: ${url}`);
    });

    const storage = new InMemoryStorage();
    await makeConnector().sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    assertConnectorResourceShapes(
      OneSignalConnector.resources,
      storage,
      CONNECTOR_ID,
    );
  });
});
